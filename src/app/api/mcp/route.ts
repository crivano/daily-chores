import { createMcpHandler, getOAuthProtectedResourceMetadataUrl, requireBearerAuth } from "@modelcontextprotocol/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

import { buildMcpServer } from "@/lib/mcp/server";
import { MCP_SCOPE } from "@/lib/oauth-core";
import { mcpResourceUrl, verifyAccessToken } from "@/lib/oauth";
import { preflight, withCors } from "@/lib/oauth-http";

/**
 * Servidor MCP (Streamable HTTP, SDK v2): revisão 2026-07-28 + fallback
 * stateless para clientes da era 2025. Auth = Bearer OAuth emitido pelo
 * próprio app (/api/oauth/*); sem token válido → 401 com WWW-Authenticate
 * apontando para /.well-known/oauth-protected-resource/api/mcp.
 */
export const dynamic = "force-dynamic";

const handler = createMcpHandler(
  ({ authInfo }) => {
    const userId = authInfo?.extra?.userId;
    if (typeof userId !== "string") throw new Error("authInfo sem userId");
    return buildMcpServer(userId);
  },
  { legacy: "stateless", onerror: (err) => console.error("[mcp]", err) },
);

async function serve(req: Request): Promise<Response> {
  const resource = mcpResourceUrl();
  const gate = requireBearerAuth({
    verifier: {
      async verifyAccessToken(token) {
        const info = await verifyAccessToken(token);
        if (!info) throw new OAuthError(OAuthErrorCode.InvalidToken, "Token inválido ou expirado.");
        return info;
      },
    },
    requiredScopes: [MCP_SCOPE],
    expectedResource: resource,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
  });
  const auth = await gate(req);
  if (auth instanceof Response) return withCors(auth);
  return withCors(await handler.fetch(req, { authInfo: auth }));
}

export { serve as GET, serve as POST, serve as DELETE };
export const OPTIONS = preflight;
