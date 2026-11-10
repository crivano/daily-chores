import { validateClientRegistration } from "@/lib/oauth-core";
import { registerClient } from "@/lib/oauth";
import { oauthError, preflight, withCors } from "@/lib/oauth-http";

/** POST — registro dinâmico de cliente público (RFC 7591), usado pelos conectores MCP. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const reg = validateClientRegistration(body);
  if (!reg.ok) return oauthError(reg.error, reg.description);

  const client = await registerClient(reg.name, reg.redirectUris);
  return withCors(
    Response.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201 },
    ),
  );
}

export const OPTIONS = preflight;
