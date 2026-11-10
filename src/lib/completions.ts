/**
 * Estado/hora de uma tarefa no dia (server-only) — compartilhado por
 * POST /api/completions e pela ferramenta MCP `set_task_state`.
 */
import { fromZonedTime } from "date-fns-tz";

import { DEFAULT_TZ, dateInTZ, isValidLocalDate, nominal, type TaskLike } from "./domain/schedule";
import { isStateAllowed, normalizeAllowedStates, type TaskState } from "./domain/states";
import { prisma } from "./prisma";
import { syncAlarms } from "./sync";

export const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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

export type SetCompletionResult =
  | { ok: true; localDate: string }
  | { ok: false; status: number; message: string };

/**
 * Grava o estado/hora da tarefa no dia.
 * - status "NONE" remove o registro; os demais criam/atualizam a linha.
 * - time ("HH:mm"): ajusta completedAt para essa hora local. Sem status,
 *   apenas ajusta a hora de um registro existente. Mudar só o estado preserva
 *   a hora; registro novo sem time usa "agora" (ou o nominal, em dia passado).
 * - date: "YYYY-MM-DD" para dias anteriores (futuro/inválido → hoje).
 */
export async function setCompletion(args: {
  userId: string;
  taskId: string;
  status: TaskState | null;
  time: string | null;
  date: string | null;
}): Promise<SetCompletionResult> {
  const { userId, taskId, status, time } = args;
  if (!status && !time) return { ok: false, status: 400, message: "status ou time obrigatório." };
  if (time && !HHMM.test(time)) return { ok: false, status: 400, message: "Horário inválido (use HH:mm)." };

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.userId !== userId) return { ok: false, status: 404, message: "Tarefa não encontrada." };

  // Restrição por tarefa: estados que ela aceita ser marcada ([] = todas).
  if (status && status !== "NONE" && !isStateAllowed(normalizeAllowedStates(task.allowedStates), status)) {
    return { ok: false, status: 400, message: "Este estado não está disponível para esta tarefa." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  const todayD = dateInTZ(new Date(), tz);
  const localDate = args.date && isValidLocalDate(args.date) && args.date <= todayD ? args.date : todayD;

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
    const existing = await prisma.completion.findUnique({
      where: { taskId_localDate: { taskId, localDate } },
    });
    if (!existing) return { ok: false, status: 400, message: "Sem registro neste dia para ajustar a hora." };
    await prisma.completion.update({
      where: { taskId_localDate: { taskId, localDate } },
      data: { completedAt: fromZonedTime(`${localDate}T${time}:00`, tz) },
    });
  }

  // Só mutações no dia de hoje afetam alarmes presentes/futuros.
  if (localDate === todayD) {
    await syncAlarms(taskId).catch((err) => console.error("[sync] pós-conclusão", err));
  }
  return { ok: true, localDate };
}
