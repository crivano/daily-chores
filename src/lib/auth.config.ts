import type { NextAuthConfig } from "next-auth";

/**
 * Config edge-safe (usada pelo proxy). Sem Prisma — apenas o suficiente para
 * verificar a sessão JWT. A instância completa (com callbacks/DB) está em
 * `src/lib/auth.ts` via `authCallbacks`.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
} satisfies NextAuthConfig;
