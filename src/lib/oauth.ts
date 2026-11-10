/**
 * OAuth 2.1 do servidor MCP (server-only — usa Prisma). O app é o próprio
 * Authorization Server; o login continua sendo o Google via Auth.js — o
 * /oauth/authorize só pede consentimento a um usuário já logado.
 * Regras puras em oauth-core.ts.
 */
import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

import { appUrl } from "./env";
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  MCP_SCOPE,
  REFRESH_TTL_MS,
  matchRedirectUri,
  randomToken,
  sha256Hex,
  verifyPkceS256,
} from "./oauth-core";
import { prisma } from "./prisma";

/** URL pública do endpoint MCP — é também o "resource" (RFC 8707/9728). */
export function mcpResourceUrl(): URL {
  return new URL(`${appUrl()}/api/mcp`);
}

export function authServerMetadata(): OAuthMetadata {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
  };
}

export async function registerClient(name: string, redirectUris: string[]) {
  return prisma.oAuthClient.create({ data: { id: randomToken(16), name, redirectUris } });
}

export function findClient(clientId: string) {
  return prisma.oAuthClient.findUnique({ where: { id: clientId } });
}

/** Pedido de /authorize válido o bastante para mostrar a tela de consentimento. */
export async function resolveAuthorizeClient(clientId: unknown, redirectUri: unknown) {
  if (typeof clientId !== "string" || typeof redirectUri !== "string") return null;
  const client = await findClient(clientId);
  if (!client || !matchRedirectUri(redirectUri, client.redirectUris)) return null;
  return client;
}

export async function issueAuthCode(args: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
}): Promise<string> {
  const code = randomToken();
  // Faxina oportunista: códigos vencidos não servem para nada.
  await prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.oAuthCode.create({
    data: { ...args, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return code;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export type TokenResult = { ok: true; tokens: TokenResponse } | { ok: false; error: string; description: string };

function newPair() {
  const access = randomToken();
  const refresh = randomToken();
  const now = Date.now();
  return {
    access,
    refresh,
    data: {
      accessHash: sha256Hex(access),
      refreshHash: sha256Hex(refresh),
      accessExpiresAt: new Date(now + ACCESS_TTL_MS),
      refreshExpiresAt: new Date(now + REFRESH_TTL_MS),
    },
  };
}

function tokenResponse(access: string, refresh: string, scope: string): TokenResponse {
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refresh,
    scope,
  };
}

const invalidGrant = (description: string): TokenResult => ({ ok: false, error: "invalid_grant", description });

/** grant_type=authorization_code (+ PKCE). O código é de uso único. */
export async function exchangeAuthCode(args: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResult> {
  // delete → uso único mesmo com requisições concorrentes (só uma apaga).
  const row = await prisma.oAuthCode
    .delete({ where: { codeHash: sha256Hex(args.code) } })
    .catch(() => null);
  if (!row || row.expiresAt < new Date()) return invalidGrant("Código inválido ou expirado.");
  if (row.clientId !== args.clientId) return invalidGrant("Código emitido para outro cliente.");
  if (row.redirectUri !== args.redirectUri) return invalidGrant("redirect_uri diferente do pedido de autorização.");
  if (!verifyPkceS256(args.codeVerifier, row.codeChallenge)) return invalidGrant("code_verifier inválido.");

  const pair = newPair();
  await prisma.oAuthGrant.create({
    data: { ...pair.data, clientId: row.clientId, userId: row.userId, scope: row.scope },
  });
  return { ok: true, tokens: tokenResponse(pair.access, pair.refresh, row.scope) };
}

/** grant_type=refresh_token — rotaciona o par (o refresh antigo deixa de valer). */
export async function refreshGrant(args: { refreshToken: string; clientId: string }): Promise<TokenResult> {
  const grant = await prisma.oAuthGrant.findUnique({ where: { refreshHash: sha256Hex(args.refreshToken) } });
  if (!grant || grant.clientId !== args.clientId || grant.refreshExpiresAt < new Date()) {
    return invalidGrant("Refresh token inválido ou expirado.");
  }
  const pair = newPair();
  // where com o hash antigo: dois refresh concorrentes → só um vence.
  const updated = await prisma.oAuthGrant
    .update({ where: { id: grant.id, refreshHash: grant.refreshHash }, data: pair.data })
    .catch(() => null);
  if (!updated) return invalidGrant("Refresh token já utilizado.");
  return { ok: true, tokens: tokenResponse(pair.access, pair.refresh, grant.scope) };
}

/** RFC 7009: revoga a concessão inteira a partir de qualquer um dos tokens. */
export async function revokeToken(token: string): Promise<void> {
  const hash = sha256Hex(token);
  await prisma.oAuthGrant.deleteMany({ where: { OR: [{ accessHash: hash }, { refreshHash: hash }] } });
}

const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/** Verifier do Resource Server (/api/mcp): token opaco → AuthInfo com o userId. */
export async function verifyAccessToken(token: string): Promise<AuthInfo | null> {
  const grant = await prisma.oAuthGrant.findUnique({ where: { accessHash: sha256Hex(token) } });
  if (!grant || grant.accessExpiresAt < new Date()) return null;
  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await prisma.oAuthGrant
      .update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return {
    token,
    clientId: grant.clientId,
    scopes: grant.scope.split(" "),
    expiresAt: Math.floor(grant.accessExpiresAt.getTime() / 1000),
    resource: mcpResourceUrl(),
    extra: { userId: grant.userId },
  };
}

/** Assistentes conectados (Configurações): uma linha por cliente com concessão ativa. */
export async function listConnectedClients(userId: string) {
  const grants = await prisma.oAuthGrant.findMany({
    where: { userId, refreshExpiresAt: { gt: new Date() } },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byClient = new Map<string, { clientId: string; name: string; connectedAt: Date; lastUsedAt: Date | null }>();
  for (const g of grants) {
    const cur = byClient.get(g.clientId);
    const lastUsedAt =
      cur?.lastUsedAt && g.lastUsedAt ? (cur.lastUsedAt > g.lastUsedAt ? cur.lastUsedAt : g.lastUsedAt) : (cur?.lastUsedAt ?? g.lastUsedAt);
    byClient.set(g.clientId, {
      clientId: g.clientId,
      name: g.client.name,
      connectedAt: cur?.connectedAt ?? g.createdAt,
      lastUsedAt,
    });
  }
  return [...byClient.values()];
}

export async function revokeClientForUser(userId: string, clientId: string): Promise<void> {
  await prisma.oAuthGrant.deleteMany({ where: { userId, clientId } });
}
