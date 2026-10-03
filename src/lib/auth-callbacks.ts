/**
 * Callbacks Auth.js v5 (Google, sessão JWT) — isolados para teste.
 *
 * GOTCHA do v5 (beta): o `user.id` passado aos callbacks NÃO é o sub do
 * provedor — é um crypto.randomUUID() (ver @auth/core getUserAndAccount) — e o
 * `token.sub` inicial herda esse valor. O googleSub real chega em
 * `profile.sub` / `account.providerAccountId`. Por isso a resolução do
 * usuário usa essas chaves (fallback: e-mail único).
 */
import type { Profile, User, Account, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { prisma } from "./prisma";

interface SignInParams {
  user: User | (Record<string, unknown> & { id?: string });
  account?: Account | null;
  profile?: Profile;
}

interface JwtParams {
  token: JWT;
  user?: User | (Record<string, unknown> & { id?: string });
  account?: Account | null;
  profile?: Profile;
}

interface SessionParams {
  session: Session;
  token: JWT;
}

/** googleSub real: profile.sub (OIDC) → account.providerAccountId. */
export function googleSubOf(
  profile: Profile | undefined,
  account: Account | null | undefined,
): string | null {
  const fromProfile = (profile as { sub?: unknown } | undefined)?.sub;
  if (typeof fromProfile === "string" && fromProfile) return fromProfile;
  const fromAccount = account?.providerAccountId;
  if (typeof fromAccount === "string" && fromAccount) return fromAccount;
  return null;
}

/** Upsert do User por googleSub (vínculo por e-mail em caso de colisão). */
export async function signInCallback({ user, profile, account }: SignInParams): Promise<boolean> {
  const googleSub = googleSubOf(profile, account);
  const email = typeof user.email === "string" ? user.email.toLowerCase() : null;
  const name = typeof user.name === "string" ? user.name : null;
  if (!googleSub || !email) return false;
  try {
    await prisma.user.upsert({
      where: { googleSub },
      update: { email, name },
      create: { googleSub, email, name },
    });
  } catch {
    // Conflito de e-mail único: vincula o googleSub na conta de mesmo e-mail.
    try {
      await prisma.user.update({ where: { email }, data: { googleSub } });
    } catch {
      return false;
    }
  }
  return true;
}

export async function jwtCallback({ token, user, account, profile }: JwtParams): Promise<JWT> {
  if (user) {
    // Sign-in: resolve pelo googleSub real; fallback pelo e-mail único.
    const googleSub = googleSubOf(profile, account);
    const email = typeof token.email === "string" && token.email
      ? token.email
      : typeof user.email === "string"
        ? user.email.toLowerCase()
        : null;
    let dbUser = googleSub ? await prisma.user.findUnique({ where: { googleSub } }) : null;
    if (!dbUser && email) dbUser = await prisma.user.findUnique({ where: { email } });
    if (dbUser) token.uid = dbUser.id;
  } else if (typeof token.uid !== "string") {
    // Auto-recuperação: cookies emitidos antes desta correção não têm uid;
    // o session action re-assina o token, então o cookie cura no 1º request.
    const email = typeof token.email === "string" ? token.email : null;
    if (email) {
      const dbUser = await prisma.user.findUnique({ where: { email } });
      if (dbUser) token.uid = dbUser.id;
    }
  }
  return token;
}

export function sessionCallback({ session, token }: SessionParams): Session {
  if (typeof token.uid === "string") session.user.id = token.uid;
  return session;
}

export const authCallbacks = {
  signIn: signInCallback,
  jwt: jwtCallback,
  session: sessionCallback,
};
