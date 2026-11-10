import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildRedirect,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  matchRedirectUri,
  normalizeScope,
  validateClientRegistration,
  verifyPkceS256,
} from "./oauth-core";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // exemplo da RFC 7636
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("PKCE S256", () => {
  it("aceita o par da RFC 7636", () => {
    expect(verifyPkceS256(VERIFIER, CHALLENGE)).toBe(true);
    expect(isValidCodeChallenge(CHALLENGE)).toBe(true);
  });
  it("recusa verifier errado ou curto", () => {
    expect(verifyPkceS256(VERIFIER.replace("d", "e"), CHALLENGE)).toBe(false);
    const short = "abc";
    const ch = createHash("sha256").update(short).digest("base64url");
    expect(verifyPkceS256(short, ch)).toBe(false);
  });
  it("challenge precisa ter 43 chars base64url", () => {
    expect(isValidCodeChallenge("plain-text")).toBe(false);
    expect(isValidCodeChallenge(undefined)).toBe(false);
  });
});

describe("redirect_uri", () => {
  it("https qualquer; http só em loopback; sem fragmento", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://a.com/cb#x")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri(42)).toBe(false);
  });

  it("match exato, ou porta livre em loopback (RFC 8252)", () => {
    const reg = ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3000/callback"];
    expect(matchRedirectUri("https://claude.ai/api/mcp/auth_callback", reg)).toBe(true);
    expect(matchRedirectUri("https://claude.ai/api/mcp/other", reg)).toBe(false);
    expect(matchRedirectUri("http://localhost:51234/callback", reg)).toBe(true);
    expect(matchRedirectUri("http://localhost:51234/evil", reg)).toBe(false);
    expect(matchRedirectUri("http://127.0.0.1:3000/callback", reg)).toBe(false); // host diferente
  });
});

describe("registro dinâmico (DCR)", () => {
  it("aceita cliente público e dá nome padrão", () => {
    const r = validateClientRegistration({ redirect_uris: ["https://claude.ai/cb", "https://claude.ai/cb"] });
    expect(r).toEqual({ ok: true, name: "Cliente MCP", redirectUris: ["https://claude.ai/cb"] });
  });
  it("recusa cliente confidencial e URIs inválidas", () => {
    expect(validateClientRegistration({ redirect_uris: ["https://a.com/cb"], token_endpoint_auth_method: "client_secret_basic" }).ok).toBe(false);
    expect(validateClientRegistration({ redirect_uris: ["http://evil.com/cb"] }).ok).toBe(false);
    expect(validateClientRegistration({ redirect_uris: [] }).ok).toBe(false);
    expect(validateClientRegistration(null).ok).toBe(false);
  });
});

describe("escopo e redirect", () => {
  it("só existe o escopo mcp", () => {
    expect(normalizeScope(undefined)).toBe("mcp");
    expect(normalizeScope("mcp")).toBe("mcp");
    expect(normalizeScope("mcp mcp")).toBe("mcp");
    expect(normalizeScope("admin")).toBeNull();
  });
  it("preserva a query registrada e omite undefined", () => {
    expect(buildRedirect("https://a.com/cb?x=1", { code: "c", state: undefined })).toBe("https://a.com/cb?x=1&code=c");
  });
});
