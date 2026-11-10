import { appUrl } from "@/lib/env";
import { buildRedirect, isValidCodeChallenge, normalizeScope } from "@/lib/oauth-core";
import { mcpResourceUrl, resolveAuthorizeClient } from "@/lib/oauth";

export interface AuthorizeRequest {
  client: { id: string; name: string };
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string | undefined;
  issuer: string;
}

export type AuthorizeValidation =
  // client_id/redirect_uri inválidos: NUNCA redirecionar (RFC 6749 §4.1.2.1).
  | { kind: "fatal"; message: string }
  // demais erros voltam ao cliente pelo redirect_uri.
  | { kind: "redirect"; url: string }
  | { kind: "ok"; request: AuthorizeRequest };

function sameResource(a: string, b: URL): boolean {
  const norm = (s: string) => s.replace(/#.*$/, "").replace(/\/+$/, "");
  return norm(a) === norm(b.toString());
}

/** Valida os parâmetros de /oauth/authorize (página e server action usam o mesmo código). */
export async function validateAuthorizeRequest(p: Record<string, string | undefined>): Promise<AuthorizeValidation> {
  const client = await resolveAuthorizeClient(p.client_id, p.redirect_uri);
  if (!client) {
    return { kind: "fatal", message: "Aplicativo desconhecido ou endereço de retorno não registrado." };
  }
  const redirectUri = p.redirect_uri!;
  const issuer = appUrl();
  const fail = (error: string, description: string): AuthorizeValidation => ({
    kind: "redirect",
    url: buildRedirect(redirectUri, { error, error_description: description, state: p.state, iss: issuer }),
  });

  if (p.response_type !== "code") return fail("unsupported_response_type", "Use response_type=code.");
  if (p.code_challenge_method !== "S256" || !isValidCodeChallenge(p.code_challenge)) {
    return fail("invalid_request", "PKCE S256 obrigatório.");
  }
  const scope = normalizeScope(p.scope);
  if (!scope) return fail("invalid_scope", "Escopo suportado: mcp.");
  if (p.resource && !sameResource(p.resource, mcpResourceUrl())) {
    return fail("invalid_target", "Recurso desconhecido.");
  }

  return {
    kind: "ok",
    request: {
      client: { id: client.id, name: client.name },
      redirectUri,
      codeChallenge: p.code_challenge!,
      scope,
      state: p.state,
      issuer,
    },
  };
}
