/**
 * Respostas HTTP do OAuth/MCP (server-only): documentos de descoberta
 * (RFC 8414 / RFC 9728) e helpers de CORS — clientes MCP baseados em browser
 * (ex.: MCP Inspector) chamam register/token cross-origin.
 */
import { oauthMetadataResponse, type AuthMetadataOptions } from "@modelcontextprotocol/server";

import { MCP_SCOPE } from "./oauth-core";
import { authServerMetadata, mcpResourceUrl } from "./oauth";

export function discoveryOptions(): AuthMetadataOptions {
  const resource = mcpResourceUrl();
  return {
    oauthMetadata: authServerMetadata(),
    resourceServerUrl: resource,
    resourceName: "Daily Chores",
    scopesSupported: [MCP_SCOPE],
    // http só em localhost (dev); em produção o issuer é o https do Cloud Run.
    dangerouslyAllowInsecureIssuerUrl: resource.protocol === "http:",
  };
}

/** Serve os documentos .well-known; 404 para caminhos não reconhecidos. */
export function discoveryResponse(req: Request): Response {
  return oauthMetadataResponse(req, discoveryOptions()) ?? Response.json({ error: "not_found" }, { status: 404 });
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Erro OAuth no formato JSON da RFC 6749 §5.2. */
export function oauthError(error: string, description: string, status = 400): Response {
  return withCors(
    Response.json(
      { error, error_description: description },
      { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    ),
  );
}

/** Corpo de token/revoke: form-urlencoded (padrão OAuth) ou JSON. */
export async function readFormBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const json = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    for (const [k, v] of Object.entries(json ?? {})) if (typeof v === "string") out[k] = v;
    return out;
  }
  const params = new URLSearchParams(await req.text().catch(() => ""));
  for (const [k, v] of params) out[k] = v;
  return out;
}
