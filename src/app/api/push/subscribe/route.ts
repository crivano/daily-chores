import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pushConfigured } from "@/lib/push";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  if (!pushConfigured()) {
    return Response.json(
      { error: "Web Push não configurado no servidor (chaves VAPID ausentes)." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
    | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const authKey = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint || !p256dh || !authKey) {
    return Response.json({ error: "Assinatura push incompleta." }, { status: 400 });
  }

  // Upsert por endpoint (uma assinatura por dispositivo).
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId, p256dh, auth: authKey },
    create: { userId, endpoint, p256dh, auth: authKey },
  });
  return Response.json({ ok: true });
}
