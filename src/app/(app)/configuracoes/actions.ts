"use server";

import { auth, signOut } from "@/lib/auth";
import { revokeClientForUser } from "@/lib/oauth";

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

/** Revoga o acesso de um assistente de IA (concessões OAuth do usuário para o cliente). */
export async function revokeAssistantAction(clientId: string): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || typeof clientId !== "string") return;
  await revokeClientForUser(userId, clientId);
}
