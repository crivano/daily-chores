import { discoveryResponse } from "@/lib/oauth-http";

// RFC 9728 — metadados do recurso protegido (/api/mcp → /.well-known/oauth-protected-resource/api/mcp).
// Também responde na raiz (/.well-known/oauth-protected-resource), que alguns clientes sondam.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.replace(/\/+$/, "") === "/.well-known/oauth-protected-resource") {
    url.pathname = "/.well-known/oauth-protected-resource/api/mcp";
    return discoveryResponse(new Request(url, req));
  }
  return discoveryResponse(req);
}
export const OPTIONS = GET;
