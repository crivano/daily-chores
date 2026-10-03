/**
 * Disparador de alarmes — chamado pelo Cloud Tasks (produção, OIDC da SA
 * alarm-runner) ou pela fila local de dev (x-dev-token).
 *
 * Sempre responde 200 para descartes (inativa/não devida/concluída/stale):
 * a fila não deve retentar. Atrasos: dispara mesmo assim se ainda válida.
 * Idempotência via AlarmDelivered — nunca envia push 2x pelo mesmo kind.
 */
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ, dateInTZ, due, effectiveAt } from "@/lib/domain/schedule";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { sendPushToUser } from "@/lib/push";
import { prisma } from "@/lib/prisma";
import { syncAlarms } from "@/lib/sync";

export async function POST(req: Request) {
  if (!(await isAuthorizedInternalRequest(req))) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { taskId?: unknown; localDate?: unknown; kind?: unknown }
    | null;
  const taskId = typeof body?.taskId === "string" ? body.taskId : null;
  const localDate = typeof body?.localDate === "string" ? body.localDate : null;
  const kind = body?.kind === "SHIFTED" ? "SHIFTED" : "NOMINAL";
  const discard = (reason: string) => Response.json({ ok: true, discarded: reason });

  if (!taskId || !localDate) return discard("payload");

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || !task.active) return discard("task");

  const user = await prisma.user.findUnique({ where: { id: task.userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  if (localDate !== dateInTZ(new Date(), tz)) return discard("stale"); // disparou após virar o dia
  if (!due(task, localDate)) return discard("not-due");

  const allTasks = await prisma.task.findMany({ where: { userId: task.userId } });
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const completions = await prisma.completion.findMany({
    where: { userId: task.userId, localDate },
  });
  const complByTask = new Map(completions.map((c) => [c.taskId, c]));

  if (complByTask.has(task.id)) return discard("completed");
  const eff = effectiveAt(task, localDate, tz, complByTask, tasksById);
  if (!eff) return discard("no-effective");

  try {
    await prisma.alarmDelivered.create({ data: { taskId, localDate, kind } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return discard("already-delivered");
    throw err;
  }

  const bodyText = formatInTimeZone(new Date(), tz, "HH:mm");
  const push = await sendPushToUser(task.userId, {
    taskId: task.id,
    title: task.name,
    body: bodyText,
    tag: `alarm-${task.id}-${localDate}`,
  });

  // Agenda a próxima ocorrência (e re-sincroniza a cadeia de relativas).
  await syncAlarms(task.id).catch((err) => console.error("[sync] pós-disparo", err));

  return Response.json({ ok: true, delivered: true, pushSent: push.sent });
}
