import { fromZonedTime } from "date-fns-tz";

import { auth } from "@/lib/auth";
import { DEFAULT_TZ, dateInTZ, isValidLocalDate, nominal } from "@/lib/domain/schedule";
import type { TaskLike } from "@/lib/domain/schedule";
import { isTaskState, type TaskState } from "@/lib/domain/states";
import { getDayPayload } from "@/lib/day";
import { prisma } from "@/lib/prisma";
import { syncAlarms } from "@/lib/sync";

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Instante padrão de um registro novo sem hora informada:
 * - hoje → agora (comportamento clássico);
 * - dia passado → horário nominal da tarefa (ou 23:59 local se sem hora), para
 *   não gerar shifts absurdos (+25h) nas cadeias do dia ajustado.
 */
function defaultCompletedAt(task: TaskLike, localDate: string, todayD: string, tz: string): Date {
  if (localDate >= todayD) return new Date();
  return nominal(task, localDate, tz) ?? fromZonedTime(`${localDate}T23:59:00`, tz);
}

/**
 * POST {taskId, status?, date?, time?} — grava o estado/hora da tarefa no dia.
 * - status: "NONE" remove o registro; os demais valores de Completion.status
 *   criam/atualizam a linha.
 * - time ("HH:mm"): ajusta completedAt para essa hora local do dia. Sem status,
 *   apenas ajusta a hora de um registro existente. Mudar só o estado preserva
 *   a hora; registro novo sem time usa "agora".
 * - date: "YYYY-MM-DD" para ajustes em dias anteriores (nunca futuro).
 * Responde com o payload do dia atualizado ({ok, day}) — mudanças de shift em
 * cadeia já vêm refletidas. Compat legado: done:true/false → DONE/NONE.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { taskId?: unknown; status?: unknown; time?: unknown; date?: unknown; done?: unknown }
    | null;
  const taskId = typeof body?.taskId === "string" ? body.taskId : null;
  if (!taskId) return Response.json({ error: "taskId obrigatório." }, { status: 400 });

  let status: TaskState | null = null;
  if (isTaskState(body?.status)) status = body.status;
  else if (body?.done === true) status = "DONE";
  else if (body?.done === false) status = "NONE";

  const time = typeof body?.time === "string" && HHMM.test(body.time) ? body.time : null;
  if (!status && !time) {
    return Response.json({ error: "status ou time obrigatório." }, { status: 400 });
  }

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.userId !== userId) {
    return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  const todayD = dateInTZ(new Date(), tz);
  const bodyDate = typeof body?.date === "string" ? body.date : null;
  const localDate = bodyDate && isValidLocalDate(bodyDate) && bodyDate <= todayD ? bodyDate : todayD;

  if (status === "NONE") {
    await prisma.completion.deleteMany({ where: { taskId, localDate } });
  } else if (status) {
    const existing = await prisma.completion.findUnique({
      where: { taskId_localDate: { taskId, localDate } },
    });
    const completedAt = time
      ? fromZonedTime(`${localDate}T${time}:00`, tz)
      : existing?.completedAt ?? defaultCompletedAt(task, localDate, todayD, tz);
    await prisma.completion.upsert({
      where: { taskId_localDate: { taskId, localDate } },
      update: { status, completedAt },
      create: { taskId, userId, localDate, completedAt, status },
    });
  } else {
    // Ajuste apenas de hora — exige registro existente no dia.
    if (!time) return Response.json({ error: "time obrigatório." }, { status: 400 });
    const existing = await prisma.completion.findUnique({
      where: { taskId_localDate: { taskId, localDate } },
    });
    if (!existing) {
      return Response.json({ error: "Sem registro neste dia para ajustar a hora." }, { status: 400 });
    }
    await prisma.completion.update({
      where: { taskId_localDate: { taskId, localDate } },
      data: { completedAt: fromZonedTime(`${localDate}T${time}:00`, tz) },
    });
  }

  // Só mutações no dia de hoje afetam alarmes presentes/futuros.
  if (localDate === todayD) {
    await syncAlarms(taskId).catch((err) => console.error("[sync] pós-conclusão", err));
  }

  const day = await getDayPayload(userId, localDate);
  return Response.json({ ok: true, day });
}
