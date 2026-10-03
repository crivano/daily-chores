import { auth } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push";

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const result = await sendPushToUser(userId, {
    taskId: "test",
    title: "Daily Chores",
    body: "Este é um alarme de teste 🔔",
    tag: "test-push",
  });
  if (result.skipped) {
    return Response.json(
      { error: "Web Push não configurado no servidor (chaves VAPID ausentes)." },
      { status: 503 },
    );
  }
  return Response.json(result);
}
