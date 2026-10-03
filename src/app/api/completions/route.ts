import { auth } from "@/lib/auth";
import { DEFAULT_TZ, dateInTZ } from "@/lib/domain/schedule";
import { prisma } from "@/lib/prisma";
import { syncAlarms } from "@/lib/sync";

/**
 * POST {taskId, done, date?} — done=true cria com completedAt=now() (timestamp
 * real do clique); done=false desfaz. Após a mutação sincroniza a cadeia de
 * alarmes da tarefa (marcar âncora re-agenda as relativas).
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { taskId?: unknown; done?: unknown; date?: unknown }
    | null;
  const taskId = typeof body?.taskId === "string" ? body.taskId : null;
  const done = body?.done === true;
  if (!taskId) return Response.json({ error: "taskId obrigatório." }, { status: 400 });

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.userId !== userId) {
    return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  const todayD = dateInTZ(new Date(), tz);
  const localDate =
    typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : todayD;

  if (done) {
    const completedAt = new Date();
    await prisma.completion.upsert({
      where: { taskId_localDate: { taskId, localDate } },
      update: { completedAt },
      create: { taskId, userId, localDate, completedAt },
    });
    await syncAlarms(taskId).catch((err) => console.error("[sync] pós-conclusão", err));
    return Response.json({ ok: true, completedAt: completedAt.toISOString() });
  }

  await prisma.completion.deleteMany({ where: { taskId, localDate } });
  await syncAlarms(taskId).catch((err) => console.error("[sync] pós-desfazer", err));
  return Response.json({ ok: true, completedAt: null });
}
