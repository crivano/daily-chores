/**
 * Construção do payload do dia (server-only — usa Prisma).
 * Origem única de verdade para GET /api/day e para a resposta de mutações
 * (POST /api/completions devolve o mesmo payload já atualizado).
 */
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

import type { DayPayload, DayTaskDTO } from "./domain/day";
import {
  DEFAULT_TZ,
  dateInTZ,
  due,
  effectiveAt,
  formatShift,
  isValidLocalDate,
  parseLocalDate,
  shiftOf,
  type CompletionsByTask,
  type TaskLike,
  type TasksById,
} from "./domain/schedule";
import { isConclusive, isTaskState, type TaskState } from "./domain/states";
import { prisma } from "./prisma";

function stateOf(taskId: string, complByTask: CompletionsByTask): TaskState {
  const c = complByTask.get(taskId);
  if (!c) return "NONE";
  // status desconhecido no banco → degrada para DONE (comportamento histórico)
  return isTaskState(c.status) ? c.status : "DONE";
}

/**
 * Payload completo do dia `requested` ("YYYY-MM-DD"). Ausente/inválido/futuro →
 * hoje no fuso do usuário. `alarms` só é preenchido para o dia de hoje.
 */
export async function getDayPayload(userId: string, requested?: string | null): Promise<DayPayload> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  const now = new Date();
  const todayD = dateInTZ(now, tz);
  const D = requested && isValidLocalDate(requested) && requested <= todayD ? requested : todayD;

  const [allTasks, completions] = await Promise.all([
    prisma.task.findMany({ where: { userId } }),
    prisma.completion.findMany({ where: { userId, localDate: D } }),
  ]);
  const tasksById: TasksById = new Map(allTasks.map((t) => [t.id, t]));
  const complByTask: CompletionsByTask = new Map(completions.map((c) => [c.taskId, c]));

  const timeOf = (d: Date) => formatInTimeZone(d, tz, "HH:mm");

  const toDTO = (task: TaskLike, eff: Date | undefined, shiftMs?: number, note?: string): DayTaskDTO => {
    const c = complByTask.get(task.id);
    return {
      taskId: task.id,
      name: task.name,
      state: stateOf(task.id, complByTask),
      completedAt: c ? c.completedAt.toISOString() : null,
      completedAtLabel: c ? timeOf(c.completedAt) : null,
      timeLabel: eff ? timeOf(eff) : undefined,
      shiftLabel: shiftMs !== undefined ? formatShift(shiftMs) || undefined : undefined,
      note,
    };
  };

  const dueTasks = allTasks.filter((t) => t.active && due(t, D));

  const timed = dueTasks
    .filter((t) => t.time)
    .map((t) => {
      const eff = effectiveAt(t, D, tz, complByTask, tasksById)!;
      return { task: t, eff, sort: eff.getTime() };
    })
    .sort((a, b) => a.sort - b.sort)
    .map(({ task, eff }) =>
      toDTO(task, eff, task.anchorId ? shiftOf(task, D, tz, complByTask, tasksById) : 0),
    );

  const timeless = dueTasks
    .filter((t) => !t.time)
    .map((t) => {
      const eff = effectiveAt(t, D, tz, complByTask, tasksById);
      const anchor = t.anchorId ? tasksById.get(t.anchorId) : undefined;
      const anchorCompletion = t.anchorId ? complByTask.get(t.anchorId) : undefined;
      const anchorConclusive = anchorCompletion ? isConclusive(anchorCompletion.status) : false;
      return {
        sort: eff?.getTime() ?? Infinity,
        dto: toDTO(t, eff, undefined, anchor && !anchorConclusive ? `após ${anchor.name}` : undefined),
      };
    })
    .sort((a, b) => a.sort - b.sort)
    .map((x) => x.dto);

  // Qualquer registro suprime o alarme (conclusivos concluem; CANCELADO silencia).
  const alarms =
    D === todayD
      ? dueTasks
          .filter((t) => !complByTask.has(t.id))
          .flatMap((t) => {
            const eff = effectiveAt(t, D, tz, complByTask, tasksById);
            return eff && eff.getTime() > now.getTime()
              ? [{ taskId: t.id, name: t.name, at: eff.getTime() }]
              : [];
          })
      : [];

  const { y, m, d } = parseLocalDate(D);
  // Meio-dia UTC fixo: formatar a data do dia sem depender do fuso de execução.
  const dateLabel = formatInTimeZone(
    new Date(Date.UTC(y, m - 1, d, 12)),
    "UTC",
    "EEEE, d 'de' MMMM 'de' yyyy",
    { locale: ptBR },
  );

  return {
    date: D,
    todayDate: todayD,
    today: D === todayD,
    timezone: tz,
    tzDefaulted: !user?.timezone,
    dateLabel,
    total: dueTasks.length,
    concluded: dueTasks.filter((t) => {
      const c = complByTask.get(t.id);
      return c ? isConclusive(c.status) : false;
    }).length,
    cancelled: dueTasks.filter((t) => complByTask.get(t.id)?.status === "CANCELLED").length,
    tasks: { timed, timeless },
    alarms,
  };
}
