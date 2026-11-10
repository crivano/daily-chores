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
  validateExercises,
  validateValuesPatch,
  valuesDiffer,
  workoutCompletionAction,
  type ExerciseInput,
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

/**
 * Grava a lista completa (a ordem do array vira `position`): ids conhecidos e
 * ativos são atualizados; sem id (ou id desconhecido) cria; ativos ausentes da
 * lista são arquivados — o histórico de logs continua apontando para eles.
 */
export async function saveExercises(tx: Tx, taskId: string, list: ExerciseInput[]): Promise<void> {
  const current = await tx.exercise.findMany({ where: { taskId, archivedAt: null } });
  const currentIds = new Set(current.map((e) => e.id));
  const kept = new Set<string>();
  for (let position = 0; position < list.length; position += 1) {
    const { id, ...fields } = list[position];
    if (id && currentIds.has(id)) {
      kept.add(id);
      await tx.exercise.update({ where: { id }, data: { ...fields, position } });
    } else {
      await tx.exercise.create({ data: { ...fields, position, taskId } });
    }
  }
  const removed = current.filter((e) => !kept.has(e.id)).map((e) => e.id);
  if (removed.length > 0) {
    await tx.exercise.updateMany({ where: { id: { in: removed } }, data: { archivedAt: new Date() } });
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
 * Instante de um registro novo: hoje → agora; dia passado → horário nominal da
 * tarefa (ou 23:59 local se sem hora) — mesma regra de POST /api/completions,
 * para não criar shifts absurdos nas cadeias do dia ajustado.
 */
function defaultDoneAt(task: Task, localDate: string, todayD: string, tz: string): Date {
  if (localDate >= todayD) return new Date();
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
  task: Pick<Task, "id" | "userId" | "allowedStates">,
  localDate: string,
  wasAllDone: boolean,
): Promise<void> {
  const taskId = task.id;
  const active = await tx.exercise.findMany({ where: { taskId, archivedAt: null }, select: { id: true } });
  const logs = await tx.exerciseLog.findMany({ where: { taskId, localDate } });
  const completion = await tx.completion.findUnique({ where: { taskId_localDate: { taskId, localDate } } });
  const lastDoneAt = logs.reduce<Date | null>((max, l) => (max == null || l.doneAt > max ? l.doneAt : max), null);
  const action = workoutCompletionAction({
    wasAllDone,
    isAllDone: allActiveDone(
      active.map((e) => e.id),
      logs.map((l) => l.exerciseId),
    ),
    current: completion && isTaskState(completion.status) ? completion.status : completion ? "DONE" : null,
    autoState: autoCompleteState(normalizeAllowedStates(task.allowedStates)),
    lastDoneAt,
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
  const localDate = dateInTZ(new Date(), task.user.timezone ?? DEFAULT_TZ);
  await applyWorkoutCompletion(tx, task, localDate, false);
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
  const localDate = args.date && isValidLocalDate(args.date) && args.date <= todayD ? args.date : todayD;

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

  await prisma.$transaction(async (tx) => {
    if (planChanged) {
      await tx.exercise.update({ where: { id: exerciseId }, data: patch });
    }

    const done = args.done ?? existingLog != null;
    if (!done) {
      if (existingLog) await tx.exerciseLog.delete({ where: { id: existingLog.id } });
    } else {
      // Snapshot: valores do registro existente (ou do plano) + ajuste pedido.
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
          doneAt: defaultDoneAt(task, localDate, todayD, tz),
        },
      });
    }

    await applyWorkoutCompletion(tx, task, localDate, wasAllDone);
  });

  // Só mutações no dia de hoje afetam alarmes presentes/futuros.
  if (localDate === todayD) {
    await syncAlarms(taskId).catch((err) => console.error("[sync] pós-exercício", err));
  }
  return { ok: true, localDate };
}
