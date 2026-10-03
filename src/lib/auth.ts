import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { authCallbacks } from "./auth-callbacks";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [Google],
  callbacks: authCallbacks,
});
