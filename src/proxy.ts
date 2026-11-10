import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// Middleware edge-safe (sem Prisma): protege páginas e /api/*, exceto
// /api/auth/** e /api/internal/** (estas usam OIDC/x-dev-token próprios) e o
// servidor MCP: /api/mcp (Bearer OAuth próprio), /api/oauth/** e /.well-known/**.
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/manifest.webmanifest", "/sw.js", "/favicon.ico", "/robots.txt"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/internal") ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/oauth/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname.startsWith("/sounds")
  );
}

export default auth((req) => {
  const { nextUrl } = req;
  if (isPublic(nextUrl.pathname)) return NextResponse.next();

  if (!req.auth) {
    if (nextUrl.pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    // Volta ao destino depois do login (ex.: consentimento OAuth do MCP).
    const login = new URL("/login", nextUrl);
    if (nextUrl.pathname !== "/") login.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icons/|sounds/|sw\\.js|manifest\\.webmanifest).*)"],
};
