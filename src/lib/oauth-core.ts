/**
 * OAuth 2.1 do servidor MCP — funções PURAS (sem Prisma), testadas em
 * oauth-core.test.ts. A persistência fica em lib/oauth.ts.
 *
 * Política (cliente público, como os conectores MCP usam):
 * - PKCE S256 obrigatório; sem client_secret;
 * - redirect_uri: https qualquer, ou http SÓ em loopback (localhost,
 *   127.0.0.1, [::1] — apps nativos/CLI como o Claude Code);
 * - o redirect_uri do /authorize tem de ser IGUAL a um registrado. Exceção
 *   RFC 8252 §7.3: em loopback a porta pode variar (CLIs abrem porta efêmera).
 */
import { createHash, randomBytes } from "node:crypto";

export const MCP_SCOPE = "mcp";
export const CODE_TTL_MS = 5 * 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 h
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias (rotaciona a cada uso)
export const MAX_REDIRECT_URIS = 10;
export const CLIENT_NAME_MAX = 100;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hash guardado no banco no lugar do segredo (código/token). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** PKCE S256: BASE64URL(SHA256(verifier)) === challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  // RFC 7636 §4.1: 43–128 chars do conjunto unreserved.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === "string" && /^[A-Za-z0-9\-_]{43}$/.test(challenge);
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** redirect_uri aceitável no registro: https, ou http em loopback; sem fragmento. */
export function isAllowedRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  const url = parseUrl(raw);
  if (!url || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** redirect_uri do pedido bate com algum registrado? (porta livre em loopback) */
export function matchRedirectUri(requested: string, registered: string[]): boolean {
  if (registered.includes(requested)) return true;
  const req = parseUrl(requested);
  if (!req || req.protocol !== "http:" || !LOOPBACK_HOSTS.has(req.hostname)) return false;
  return registered.some((r) => {
    const reg = parseUrl(r);
    return (
      reg != null &&
      reg.protocol === "http:" &&
      reg.hostname === req.hostname &&
      reg.pathname === req.pathname &&
      reg.search === req.search
    );
  });
}

export type ClientRegistration =
  | { ok: true; name: string; redirectUris: string[] }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

/** Valida o corpo do DCR (RFC 7591) — só o que um cliente público precisa. */
export function validateClientRegistration(body: unknown): ClientRegistration {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid_client_metadata", description: "Corpo JSON obrigatório." };
  }
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris obrigatório (1 a 10 URIs)." };
  }
  for (const u of uris) {
    if (!isAllowedRedirectUri(u)) {
      return {
        ok: false,
        error: "invalid_redirect_uri",
        description: "redirect_uri deve ser https ou http em localhost/127.0.0.1, sem fragmento.",
      };
    }
  }
  const authMethod = b.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: "Apenas clientes públicos (token_endpoint_auth_method = none) são aceitos.",
    };
  }
  const rawName = typeof b.client_name === "string" ? b.client_name.trim() : "";
  const name = (rawName || "Cliente MCP").slice(0, CLIENT_NAME_MAX);
  return { ok: true, name, redirectUris: [...new Set(uris as string[])] };
}

/** Escopo efetivo: só existe "mcp" (ausente/vazio = "mcp"; outro = inválido). */
export function normalizeScope(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return MCP_SCOPE;
  if (typeof raw !== "string") return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.every((p) => p === MCP_SCOPE) ? MCP_SCOPE : null;
}

/** Monta o redirect de volta ao cliente com os parâmetros dados (preserva a query registrada). */
export function buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return url.toString();
}
