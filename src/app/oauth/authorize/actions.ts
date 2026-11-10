"use server";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { buildRedirect } from "@/lib/oauth-core";
import { issueAuthCode } from "@/lib/oauth";
import { validateAuthorizeRequest } from "./validate";

/**
 * Consentimento: reconstrói e RE-VALIDA o pedido a partir do form (nada do
 * que veio do client é confiado) e devolve o usuário ao redirect_uri com o
 * código (Permitir) ou error=access_denied (Negar).
 */
export async function decideAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const params: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") params[k] = v;

  const v = await validateAuthorizeRequest(params);
  if (v.kind === "fatal") redirect("/");
  if (v.kind === "redirect") redirect(v.url);

  const { request } = v;
  if (params.decision !== "allow") {
    redirect(buildRedirect(request.redirectUri, { error: "access_denied", state: request.state, iss: request.issuer }));
  }

  const code = await issueAuthCode({
    clientId: request.client.id,
    userId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scope: request.scope,
  });
  redirect(buildRedirect(request.redirectUri, { code, state: request.state, iss: request.issuer }));
}
