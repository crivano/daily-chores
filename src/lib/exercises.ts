/**
 * Exercícios de séries (server-only — usa Prisma). As regras vivem em
 * domain/workout.ts; aqui só a persistência:
 * - resolveExercisesInput/saveExercises: cadastro (criar/alterar/arquivar)
 *   junto com POST/PATCH da tarefa;
 * - setExerciseLog: marcação/ajuste de um exercício no dia + efeito na
 *   Completion da série (conclusão automática).
 */
import { fromZonedTime } from "date-fns-tz";

import type { Exercise, Prisma, Task } from "@/generated/prisma/client";
import { DEFAULT_TZ, dateInTZ, isValidLocalDate, nominal } from "./domain/schedule";
import { isTaskState, normalizeAllowedStates } from "./domain/states";
import {
  autoCompleteState,
  describeDayValueAdjustment,
  describeExerciseAdded,
  describeExerciseDiff,
  describeExerciseRemoved,
  describeExerciseValuesDiff,
  describePlanEdit,
  exerciseOrderChanged,
  validateExercises,
  validateValuesPatch,
  valuesDiffer,
  workoutCompletionAction,
  type ExerciseInput,
  type ExerciseSnapshot,
  type ExerciseValues,
  type LoadUnit,
  type TaskKind,
} from "./domain/workout";
import { prisma } from "./prisma";
import { syncAlarms } from "./sync";

type Tx = Prisma.TransactionClient;

export type ExercisesResolution =
  | { ok: true; data: ExerciseInput[] | null } // null = não mexer nos exercícios
  | { ok: false; status: number; message: string };

/**
 * Decide o que fazer com `exercises` do corpo de POST/PATCH:
 * - tarefa SIMPLE: ignora (exercícios antigos, se houver, ficam guardados);
 * - WORKOUT com lista: valida (≥ 1);
 * - WORKOUT sem lista: criação exige; patch exige que já existam ativos.
 */
export async function resolveExercisesInput(
  kind: TaskKind,
  raw: unknown,
  existingTaskId?: string,
): Promise<ExercisesResolution> {
  if (kind !== "WORKOUT") return { ok: true, data: null };
  if (raw === undefined) {
    const count = existingTaskId
      ? await prisma.exercise.count({ where: { taskId: existingTaskId, archivedAt: null } })
      : 0;
    if (count === 0) return { ok: false, status: 400, message: "Cadastre pelo menos um exercício na série." };
    return { ok: true, data: null };
  }
  const r = validateExercises(raw);
  return r.ok ? { ok: true, data: r.data } : { ok: false, status: 400, message: r.message };
}

function snapshotOf(e: Exercise): ExerciseSnapshot {
  return {
    name: e.name,
    restSec: e.restSec,
    notes: e.notes,
    ...valuesOf(e),
  };
}

/**
 * Grava a lista completa (a ordem do array vira `position`): ids conhecidos e
 * ativos são atualizados; sem id (ou id desconhecido) cria; ativos ausentes da
 * lista são arquivados — o histórico de logs continua apontando para eles.
 *
 * Quando `recordChanges` é true (edição de série já existente), registra em
 * `ExerciseChange` cada adição, edição, remoção e mudança de ordem.
 */
export async function saveExercises(
  tx: Tx,
  taskId: string,
  list: ExerciseInput[],
  opts?: { recordChanges?: boolean },
): Promise<void> {
  const current = await tx.exercise.findMany({
    where: { taskId, archivedAt: null },
    orderBy: { position: "asc" },
  });
  const shouldLog = opts?.recordChanges === true && current.length > 0;
  const currentById = new Map(current.map((e) => [e.id, e]));
  const keptIds: string[] = [];
  const changes: Prisma.ExerciseChangeCreateManyInput[] = [];

  for (let position = 0; position < list.length; position += 1) {
    const { id, ...fields } = list[position];
    const prev = id ? currentById.get(id) : undefined;
    if (prev) {
      keptIds.push(prev.id);
      await tx.exercise.update({ where: { id: prev.id }, data: { ...fields, position } });
      if (shouldLog) {
        const diffs = describeExerciseDiff(snapshotOf(prev), fields);
        if (diffs.length > 0) {
          changes.push({
            taskId,
            exerciseId: prev.id,
            exerciseName: fields.name,
            summary: describePlanEdit(diffs),
          });
        }
      }
    } else {
      const created = await tx.exercise.create({ data: { ...fields, position, taskId } });
      if (shouldLog) {
        changes.push({
          taskId,
          exerciseId: created.id,
          exerciseName: fields.name,
          summary: describeExerciseAdded(fields),
        });
      }
    }
  }

  const keptSet = new Set(keptIds);
  const removed = current.filter((e) => !keptSet.has(e.id));
  if (removed.length > 0) {
    await tx.exercise.updateMany({
      where: { id: { in: removed.map((e) => e.id) } },
      data: { archivedAt: new Date() },
    });
    if (shouldLog) {
      for (const r of removed) {
        changes.push({
          taskId,
          exerciseId: r.id,
          exerciseName: r.name,
          summary: describeExerciseRemoved(),
        });
      }
    }
  }

  if (shouldLog && exerciseOrderChanged(current.map((e) => e.id), keptIds)) {
    changes.push({
      taskId,
      exerciseId: null,
      exerciseName: "(série)",
      summary: `Ordem alterada: ${list.map((e) => e.name).join(" → ")}`,
    });
  }

  if (changes.length > 0) {
    await tx.exerciseChange.createMany({ data: changes });
  }
}

/** Exercícios ativos da tarefa, na ordem de exibição. */
export function activeExercises(taskId: string): Promise<Exercise[]> {
  return prisma.exercise.findMany({ where: { taskId, archivedAt: null }, orderBy: { position: "asc" } });
}

function valuesOf(e: { sets: number | null; reps: number | null; durationSec: number | null; load: number | null; loadUnit: string }): ExerciseValues {
  return {
    sets: e.sets,
    reps: e.reps,
    durationSec: e.durationSec,
    load: e.load,
    loadUnit: (e.loadUnit === "lb" ? "lb" : "kg") as LoadUnit,
  };
}

/**
 * Instante padrão da Completion automática em dia diferente de hoje:
 * - dia passado → horário nominal da tarefa (ou 23:59 local se sem hora), para
 *   não gerar shifts absurdos nas cadeias do dia ajustado;
 * - dia futuro → nominal (ou agora se sem hora) — shift 0 nas cadeias.
 * Já o `doneAt` de cada exercício registra sempre o clique real (`new Date()`).
 */
function defaultCompletedAt(
  task: Task,
  localDate: string,
  todayD: string,
  tz: string,
): Date {
  if (localDate > todayD) return nominal(task, localDate, tz) ?? new Date();
  return nominal(task, localDate, tz) ?? fromZonedTime(`${localDate}T23:59:00`, tz);
}

function allActiveDone(activeIds: string[], loggedIds: Iterable<string>): boolean {
  const logged = new Set(loggedIds);
  return activeIds.length > 0 && activeIds.every((id) => logged.has(id));
}

/**
 * Aplica `workoutCompletionAction` à Completion do dia, lendo o estado atual
 * (exercícios ativos, logs, Completion) dentro da transação.
 */
async function applyWorkoutCompletion(
  tx: Tx,
  task: Task,
  localDate: string,
  todayD: string,
  tz: string,
  wasAllDone: boolean,
): Promise<void> {
  const taskId = task.id;
  const active = await tx.exercise.findMany({ where: { taskId, archivedAt: null }, select: { id: true } });
  const logs = await tx.exerciseLog.findMany({ where: { taskId, localDate } });
  const completion = await tx.completion.findUnique({ where: { taskId_localDate: { taskId, localDate } } });
  const lastDoneAt = logs.reduce<Date | null>((max, l) => (max == null || l.doneAt > max ? l.doneAt : max), null);
  const completedAt =
    lastDoneAt == null
      ? null
      : localDate === todayD
        ? lastDoneAt
        : defaultCompletedAt(task, localDate, todayD, tz);
  const action = workoutCompletionAction({
    wasAllDone,
    isAllDone: allActiveDone(
      active.map((e) => e.id),
      logs.map((l) => l.exerciseId),
    ),
    current: completion && isTaskState(completion.status) ? completion.status : completion ? "DONE" : null,
    autoState: autoCompleteState(normalizeAllowedStates(task.allowedStates)),
    lastDoneAt: completedAt,
  });
  if (action.kind === "upsert") {
    await tx.completion.upsert({
      where: { taskId_localDate: { taskId, localDate } },
      update: { status: action.status, completedAt: action.completedAt },
      create: { taskId, userId: task.userId, localDate, status: action.status, completedAt: action.completedAt },
    });
  } else if (action.kind === "delete") {
    await tx.completion.deleteMany({ where: { taskId, localDate } });
  }
}

/**
 * Depois de editar o cadastro (PATCH com lista de exercícios): se arquivar os
 * pendentes deixou a série de HOJE toda marcada, grava a conclusão automática.
 * O caminho inverso (incluir exercício numa série já concluída) NÃO desfaz a
 * conclusão — `wasAllDone: false` impede o "delete": acrescentar um exercício
 * para os próximos treinos não deve reabrir o treino já feito.
 */
export async function completeWorkoutAfterEdit(tx: Tx, taskId: string): Promise<void> {
  const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: { user: true } });
  if (task.kind !== "WORKOUT") return;
  const tz = task.user.timezone ?? DEFAULT_TZ;
  const localDate = dateInTZ(new Date(), tz);
  await applyWorkoutCompletion(tx, task, localDate, localDate, tz, false);
}

export type ExerciseLogResult =
  | { ok: true; localDate: string }
  | { ok: false; status: number; message: string };

/**
 * Marca/desmarca um exercício no dia (`done`) e/ou ajusta seus valores
 * (`values`, patch parcial). Valores ajustados em HOJE viram o novo plano do
 * exercício (valem para os próximos treinos); em dias passados só corrigem o
 * registro daquele dia. Depois aplica o efeito na Completion da série.
 */
export async function setExerciseLog(args: {
  userId: string;
  exerciseId: string;
  date?: string | null;
  done?: boolean;
  values?: Record<string, unknown> | null;
}): Promise<ExerciseLogResult> {
  const { userId, exerciseId } = args;
  const exercise = await prisma.exercise.findUnique({ where: { id: exerciseId }, include: { task: true } });
  if (!exercise || exercise.task.userId !== userId) {
    return { ok: false, status: 404, message: "Exercício não encontrado." };
  }
  const task = exercise.task;
  if (task.kind !== "WORKOUT") {
    return { ok: false, status: 409, message: "Esta tarefa não é uma série de exercícios." };
  }

  let patch: Partial<ExerciseValues> = {};
  if (args.values) {
    const r = validateValuesPatch(args.values, exercise.name);
    if (!r.ok) return { ok: false, status: 400, message: r.message };
    patch = r.data;
  }
  if (args.done === undefined && Object.keys(patch).length === 0) {
    return { ok: false, status: 400, message: "done ou valores obrigatórios." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  const todayD = dateInTZ(new Date(), tz);
  const localDate = args.date && isValidLocalDate(args.date) ? args.date : todayD;

  const taskId = task.id;
  const [active, logsBefore] = await Promise.all([
    prisma.exercise.findMany({ where: { taskId, archivedAt: null }, select: { id: true } }),
    prisma.exerciseLog.findMany({ where: { taskId, localDate } }),
  ]);
  const wasAllDone = allActiveDone(
    active.map((e) => e.id),
    logsBefore.map((l) => l.exerciseId),
  );
  const existingLog = logsBefore.find((l) => l.exerciseId === exerciseId) ?? null;

  const plan = valuesOf(exercise);
  const planChanged = localDate === todayD && valuesDiffer(plan, patch);
  const done = args.done ?? existingLog != null;

  let changeSummary: string | null = null;
  if (planChanged) {
    const diffs = describeExerciseValuesDiff(plan, { ...plan, ...patch });
    if (diffs.length > 0) changeSummary = describeDayValueAdjustment(diffs, localDate, true);
  } else if (done && Object.keys(patch).length > 0) {
    const before = existingLog ? valuesOf(existingLog) : plan;
    const diffs = describeExerciseValuesDiff(before, { ...before, ...patch });
    if (diffs.length > 0) changeSummary = describeDayValueAdjustment(diffs, localDate, false);
  }

  await prisma.$transaction(async (tx) => {
    if (planChanged) {
      await tx.exercise.update({ where: { id: exerciseId }, data: patch });
    }

    if (!done) {
      if (existingLog) await tx.exerciseLog.delete({ where: { id: existingLog.id } });
    } else {
      // Snapshot: valores do registro existente (ou do plano) + ajuste pedido.
      // `doneAt` registra sempre o horário real do clique.
      const snapshot = { ...(existingLog ? valuesOf(existingLog) : plan), ...patch };
      await tx.exerciseLog.upsert({
        where: { exerciseId_localDate: { exerciseId, localDate } },
        update: snapshot,
        create: {
          ...snapshot,
          exerciseId,
          taskId,
          userId,
          localDate,
          doneAt: new Date(),
        },
      });
    }

    if (changeSummary) {
      await tx.exerciseChange.create({
        data: { taskId, exerciseId, exerciseName: exercise.name, summary: changeSummary },
      });
    }

    await applyWorkoutCompletion(tx, task, localDate, todayD, tz, wasAllDone);
  });

  // Só mutações no dia de hoje afetam alarmes presentes/futuros.
  if (localDate === todayD) {
    await syncAlarms(taskId).catch((err) => console.error("[sync] pós-exercício", err));
  }
  return { ok: true, localDate };
}
