import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncAlarms } from "@/lib/sync";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { timezone?: unknown; force?: unknown } | null;
  const timezone = typeof body?.timezone === "string" ? body.timezone : "";
  const force = body?.force === true;
  if (!timezone || timezone.length > 64) {
    return Response.json({ error: "Fuso horário inválido." }, { status: 400 });
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return Response.json({ error: "Fuso horário inválido." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return Response.json({ error: "Não autorizado" }, { status: 401 });

  // Grava se ainda null; com force=true (tela de configurações) sobrescreve.
  if (user.timezone == null || force) {
    await prisma.user.update({ where: { id: userId }, data: { timezone } });
    if (force) {
      // Fuso mudou → a data local de hoje pode ter mudado → re-sincroniza alarmes.
      const tasks = await prisma.task.findMany({ where: { userId }, select: { id: true } });
      for (const t of tasks) await syncAlarms(t.id).catch(() => {});
    }
    return Response.json({ timezone, updated: true });
  }
  return Response.json({ timezone: user.timezone, updated: false });
}
