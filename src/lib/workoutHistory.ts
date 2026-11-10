/**
 * Histórico de uma série de exercícios (server-only) — usado pela ferramenta
 * MCP `get_workout_history`. Lê os SNAPSHOTS de ExerciseLog (valores
 * realmente executados), não o plano atual.
 */
import { formatInTimeZone } from "date-fns-tz";

import { exerciseToDTO, type TaskExerciseDTO } from "./dto";
import { DEFAULT_TZ, addDays, dateInTZ } from "./domain/schedule";
import { clampStatsRange } from "./domain/stats";
import { prisma } from "./prisma";

export interface WorkoutSessionExercise {
  exerciseId: string;
  name: string;
  archived: boolean;
  sets: number | null;
  reps: number | null;
  durationSec: number | null;
  load: number | null;
  loadUnit: string;
  doneAt: string; // "HH:mm" no fuso do usuário
}

export interface WorkoutSession {
  date: string;
  state: string; // Completion.status do dia, ou "NONE"
  completedAt: string | null; // "HH:mm"
  exercises: WorkoutSessionExercise[];
}

export interface WorkoutHistory {
  taskId: string;
  name: string;
  from: string;
  to: string;
  timezone: string;
  plan: TaskExerciseDTO[]; // exercícios ativos (plano atual), na ordem
  sessions: WorkoutSession[]; // dias com algum registro, mais recente primeiro
}

export type WorkoutHistoryResult =
  | { ok: true; data: WorkoutHistory }
  | { ok: false; status: number; message: string };

/** [from, to] padrão: últimos 30 dias terminando hoje (máx. do clamp de stats). */
export async function getWorkoutHistory(
  userId: string,
  taskId: string,
  from?: string | null,
  to?: string | null,
): Promise<WorkoutHistoryResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { exercises: { orderBy: { position: "asc" } }, user: true },
  });
  if (!task || task.userId !== userId) return { ok: false, status: 404, message: "Tarefa não encontrada." };
  if (task.kind !== "WORKOUT") {
    return { ok: false, status: 409, message: "Esta tarefa não é uma série de exercícios." };
  }

  const tz = task.user.timezone ?? DEFAULT_TZ;
  const todayD = dateInTZ(new Date(), tz);
  const range = clampStatsRange(from ?? (to ? null : addDays(todayD, -29)), to, todayD);

  const [logs, completions] = await Promise.all([
    prisma.exerciseLog.findMany({
      where: { taskId, localDate: { gte: range.from, lte: range.to } },
      orderBy: { doneAt: "asc" },
    }),
    prisma.completion.findMany({ where: { taskId, localDate: { gte: range.from, lte: range.to } } }),
  ]);

  const exById = new Map(task.exercises.map((e) => [e.id, e]));
  const hhmm = (d: Date) => formatInTimeZone(d, tz, "HH:mm");
  const sessions = new Map<string, WorkoutSession>();
  const sessionOf = (date: string) => {
    let s = sessions.get(date);
    if (!s) {
      s = { date, state: "NONE", completedAt: null, exercises: [] };
      sessions.set(date, s);
    }
    return s;
  };
  for (const c of completions) {
    const s = sessionOf(c.localDate);
    s.state = c.status;
    s.completedAt = hhmm(c.completedAt);
  }
  for (const l of logs) {
    const ex = exById.get(l.exerciseId);
    sessionOf(l.localDate).exercises.push({
      exerciseId: l.exerciseId,
      name: ex?.name ?? "(exercício removido)",
      archived: ex?.archivedAt != null,
      sets: l.sets,
      reps: l.reps,
      durationSec: l.durationSec,
      load: l.load,
      loadUnit: l.loadUnit,
      doneAt: hhmm(l.doneAt),
    });
  }

  return {
    ok: true,
    data: {
      taskId,
      name: task.name,
      from: range.from,
      to: range.to,
      timezone: tz,
      plan: task.exercises.filter((e) => e.archivedAt == null).map(exerciseToDTO),
      sessions: [...sessions.values()].sort((a, b) => (a.date < b.date ? 1 : -1)),
    },
  };
}
