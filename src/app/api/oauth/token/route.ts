import { exchangeAuthCode, refreshGrant } from "@/lib/oauth";
import { oauthError, preflight, readFormBody, withCors } from "@/lib/oauth-http";

/** POST — token endpoint (authorization_code + PKCE, refresh_token com rotação). */
export async function POST(req: Request) {
  const form = await readFormBody(req);
  const clientId = form.client_id;
  if (!clientId) return oauthError("invalid_client", "client_id obrigatório.", 401);

  let result;
  if (form.grant_type === "authorization_code") {
    if (!form.code || !form.redirect_uri || !form.code_verifier) {
      return oauthError("invalid_request", "code, redirect_uri e code_verifier são obrigatórios.");
    }
    result = await exchangeAuthCode({
      code: form.code,
      clientId,
      redirectUri: form.redirect_uri,
      codeVerifier: form.code_verifier,
    });
  } else if (form.grant_type === "refresh_token") {
    if (!form.refresh_token) return oauthError("invalid_request", "refresh_token obrigatório.");
    result = await refreshGrant({ refreshToken: form.refresh_token, clientId });
  } else {
    return oauthError("unsupported_grant_type", "Use authorization_code ou refresh_token.");
  }

  if (!result.ok) return oauthError(result.error, result.description);
  return withCors(Response.json(result.tokens, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }));
}

export const OPTIONS = preflight;
