/**
 * Construção do payload do dia (server-only — usa Prisma).
 * Origem única de verdade para GET /api/day e para a resposta de mutações
 * (POST /api/completions devolve o mesmo payload já atualizado).
 */
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

import type { DayExerciseDTO, DayPayload, DayTaskDTO, DayWorkoutDTO } from "./domain/day";
import {
  DEFAULT_TZ,
  dateInTZ,
  due,
  effectiveAt,
  isValidLocalDate,
  parseLocalDate,
  type CompletionsByTask,
  type TaskLike,
  type TasksById,
} from "./domain/schedule";
import { isConclusive, isTaskState, normalizeAllowedStates, type TaskState } from "./domain/states";
import { compareTasksByTimeName } from "./dto";
import { prisma } from "./prisma";

function stateOf(taskId: string, complByTask: CompletionsByTask): TaskState {
  const c = complByTask.get(taskId);
  if (!c) return "NONE";
  // status desconhecido no banco → degrada para DONE (comportamento histórico)
  return isTaskState(c.status) ? c.status : "DONE";
}

/**
 * Payload completo do dia `requested` ("YYYY-MM-DD"). Ausente/inválido → hoje no
 * fuso do usuário. Dias futuros são válidos (adiantar tarefas).
 */
export async function getDayPayload(userId: string, requested?: string | null): Promise<DayPayload> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  const now = new Date();
  const todayD = dateInTZ(now, tz);
  const D = requested && isValidLocalDate(requested) ? requested : todayD;

  const [allTasks, completions] = await Promise.all([
    prisma.task.findMany({ where: { userId } }),
    prisma.completion.findMany({ where: { userId, localDate: D } }),
  ]);
  const tasksById: TasksById = new Map(allTasks.map((t) => [t.id, t]));
  const complByTask: CompletionsByTask = new Map(completions.map((c) => [c.taskId, c]));

  const timeOf = (d: Date) => formatInTimeZone(d, tz, "HH:mm");

  const dueTasks = allTasks.filter((t) => t.active && due(t, D));

  // Séries de exercícios devidas no dia: exercícios (inclui arquivados — só
  // aparecem se registrados no dia) + registros do dia.
  const workoutIds = dueTasks.filter((t) => t.kind === "WORKOUT").map((t) => t.id);
  const [exercises, exerciseLogs] = workoutIds.length
    ? await Promise.all([
        prisma.exercise.findMany({ where: { taskId: { in: workoutIds } }, orderBy: { position: "asc" } }),
        prisma.exerciseLog.findMany({ where: { taskId: { in: workoutIds }, localDate: D } }),
      ])
    : [[], []];
  const logByExercise = new Map(exerciseLogs.map((l) => [l.exerciseId, l]));

  const workoutOf = (taskId: string): DayWorkoutDTO => {
    const list: DayExerciseDTO[] = [];
    let done = 0;
    let total = 0;
    for (const e of exercises) {
      if (e.taskId !== taskId) continue;
      const log = logByExercise.get(e.id);
      const archived = e.archivedAt != null;
      if (archived && !log) continue;
      if (!archived) {
        total += 1;
        if (log) done += 1;
      }
      const v = log ?? e;
      list.push({
        exerciseId: e.id,
        name: e.name,
        sets: v.sets,
        reps: v.reps,
        durationSec: v.durationSec,
        load: v.load,
        loadUnit: v.loadUnit === "lb" ? "lb" : "kg",
        restSec: e.restSec,
        notes: e.notes,
        done: log != null,
        doneAtLabel: log ? timeOf(log.doneAt) : null,
        archived,
      });
    }
    return { exercises: list, done, total };
  };

  const toDTO = (task: TaskLike, eff: Date | undefined, note?: string): DayTaskDTO => {
    const c = complByTask.get(task.id);
    return {
      taskId: task.id,
      name: task.name,
      state: stateOf(task.id, complByTask),
      completedAt: c ? c.completedAt.toISOString() : null,
      completedAtLabel: c ? timeOf(c.completedAt) : null,
      timeLabel: eff ? timeOf(eff) : undefined,
      note,
      allowedStates: normalizeAllowedStates(task.allowedStates),
      ...(task.kind === "WORKOUT" ? { workout: workoutOf(task.id) } : {}),
    };
  };

  const timed = dueTasks
    .filter((t) => t.time)
    .map((t) => ({
      task: t,
      eff: effectiveAt(t, D, tz, complByTask, tasksById)!,
    }))
    // Ordem = hora nominal → nome (comparador canônico, idem /tarefas): pura dos
    // campos da tarefa. O horário previsto (com shift de cadeia) segue no
    // timeLabel — concluir a âncora muda o rótulo da dependente, nunca a posição.
    .sort((a, b) => compareTasksByTimeName(a.task, b.task))
    .map(({ task, eff }) => toDTO(task, eff));

  const timeless = dueTasks
    .filter((t) => !t.time)
    .map((t) => {
      const eff = effectiveAt(t, D, tz, complByTask, tasksById);
      const anchor = t.anchorId ? tasksById.get(t.anchorId) : undefined;
      const anchorCompletion = t.anchorId ? complByTask.get(t.anchorId) : undefined;
      const anchorConclusive = anchorCompletion ? isConclusive(anchorCompletion.status) : false;
      return {
        task: t,
        eff,
        note: anchor && !anchorConclusive ? `após ${anchor.name}` : undefined,
      };
    })
    // Mesma ordem canônica (aqui reduz a A→Z): a posição não depende de a âncora
    // estar concluída — só o rótulo muda ("após X" vira a hora efetiva).
    .sort((a, b) => compareTasksByTimeName(a.task, b.task))
    .map(({ task, eff, note }) => toDTO(task, eff, note));

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
  };
}
