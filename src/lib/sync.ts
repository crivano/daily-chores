/**
 * Sincronização de alarmes — idempotente, dirigida por eventos.
 * Chamada após qualquer mutação de tarefa/completion, após cada disparo e na
 * reconciliação diária. Nunca é executada por polling.
 *
 * Conjunto desejado por tarefa:
 *  (i)  alarme de HOJE — se devido, ativo, não concluído e com `effective`
 *       definido no futuro; kind = NOMINAL (se o nominal de hoje ainda não foi
 *       entregue) ou SHIFTED (nominal já entregue → a política de relativas
 *       manda alarmar de novo no horário deslocado);
 *  (ii) alarme da nextOccurrence — sempre NOMINAL, no nominal daquela data.
 *
 * O diff com AlarmQueued cancela no Cloud Tasks o que sobra e cria o que falta.
 */
import { deleteAlarm, enqueueAlarm } from "./alarms";
import {
  DEFAULT_TZ,
  alarmName,
  dateInTZ,
  due,
  effectiveAt,
  nextOccurrence,
  nominal,
  shiftOf,
  type AlarmKind,
  type CompletionsByTask,
  type TaskLike,
  type TasksById,
} from "./domain/schedule";
import { prisma } from "./prisma";
import type { Task } from "@/generated/prisma/client";

/** Tolerância para decidir se o NOMINAL foi entregue adiantado (já deslocado). */
const EARLY_DELIVERY_TOLERANCE_MS = 30_000;

interface DesiredAlarm {
  name: string;
  localDate: string;
  kind: AlarmKind;
  scheduleTime: Date;
}

function put(
  map: Map<string, DesiredAlarm>,
  task: TaskLike,
  localDate: string,
  kind: AlarmKind,
  scheduleTime: Date,
): void {
  const name = alarmName(task.id, localDate, scheduleTime);
  map.set(name, { name, localDate, kind, scheduleTime });
}

async function computeDesired(
  task: Task,
  tz: string,
  now: Date,
  todayD: string,
  tasksById: TasksById,
  complByTask: CompletionsByTask,
): Promise<Map<string, DesiredAlarm>> {
  const desired = new Map<string, DesiredAlarm>();
  if (!task.active) return desired;

  if (due(task, todayD) && !complByTask.has(task.id)) {
    const eff = effectiveAt(task, todayD, tz, complByTask, tasksById);
    if (eff) {
      const delivered = await prisma.alarmDelivered.findMany({
        where: { taskId: task.id, localDate: todayD },
      });
      const nominalDelivered = delivered.find((d) => d.kind === "NOMINAL");
      const shiftedDelivered = delivered.find((d) => d.kind === "SHIFTED");
      const shiftMs = task.anchorId ? shiftOf(task, todayD, tz, complByTask, tasksById) : 0;

      if (!nominalDelivered) {
        if (eff > now) {
          put(desired, task, todayD, "NOMINAL", eff);
        } else if (shiftMs !== 0) {
          // Âncora deslocou para o passado (gap negativo/processamento atrasado):
          // melhor tarde que nunca → agenda para já.
          put(desired, task, todayD, "NOMINAL", now);
        }
      } else if (!shiftedDelivered) {
        // Se o NOMINAL foi entregue bem ANTES do horário nominal, aquele já era
        // o alarme deslocado-adiantado (âncora concluída cedo) → não repete.
        const nom = nominal(task, todayD, tz);
        const wasEarly =
          nom != null && nominalDelivered.deliveredAt.getTime() < nom.getTime() - EARLY_DELIVERY_TOLERANCE_MS;
        if (!wasEarly) {
          if (eff > now) {
            put(desired, task, todayD, "SHIFTED", eff);
          } else if (shiftMs !== 0) {
            put(desired, task, todayD, "SHIFTED", now);
          }
        }
      }
    }
  }

  if (task.time) {
    const nextD = nextOccurrence(task, todayD);
    if (nextD) {
      const nomNext = nominal(task, nextD, tz);
      if (nomNext) put(desired, task, nextD, "NOMINAL", nomNext);
    }
  }

  return desired;
}

/**
 * Sincroniza os alarmes da tarefa e, recursivamente, de toda a cadeia de
 * dependentes (marcar/desmarcar uma âncora afeta todas as relativas).
 */
export async function syncAlarms(taskId: string, visited: Set<string> = new Set()): Promise<void> {
  if (visited.has(taskId)) return;
  visited.add(taskId);

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    await removeAllQueuedForTask(taskId);
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: task.userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  const now = new Date();
  const todayD = dateInTZ(now, tz);

  const allTasks = await prisma.task.findMany({ where: { userId: task.userId } });
  const tasksById: TasksById = new Map(allTasks.map((t) => [t.id, t]));
  const completions = await prisma.completion.findMany({
    where: { userId: task.userId, localDate: todayD },
  });
  const complByTask: CompletionsByTask = new Map(completions.map((c) => [c.taskId, c]));

  const desired = await computeDesired(task, tz, now, todayD, tasksById, complByTask);

  // Diff com o espelho (AlarmQueued) — deleta os sobrando, cria os faltantes.
  const queued = await prisma.alarmQueued.findMany({ where: { taskId: task.id } });
  for (const q of queued) {
    if (!desired.has(q.name)) {
      await deleteAlarm(q.name);
      await prisma.alarmQueued.delete({ where: { name: q.name } }).catch(() => {});
    }
  }
  const existingNames = new Set(queued.map((q) => q.name));
  for (const alarm of desired.values()) {
    if (existingNames.has(alarm.name)) continue;
    await enqueueAlarm({
      name: alarm.name,
      taskId: task.id,
      localDate: alarm.localDate,
      kind: alarm.kind,
      scheduleTime: alarm.scheduleTime,
    });
    await prisma.alarmQueued
      .create({
        data: { name: alarm.name, taskId: task.id, localDate: alarm.localDate, kind: alarm.kind },
      })
      .catch((err) => {
        if ((err as { code?: string }).code !== "P2002") throw err; // já espelhado
      });
  }

  for (const t of allTasks) {
    if (t.anchorId === task.id) await syncAlarms(t.id, visited);
  }
}

/** Remove (Cloud Tasks + espelho) todos os alarmes enfileirados de uma tarefa. */
export async function removeAllQueuedForTask(taskId: string): Promise<void> {
  const rows = await prisma.alarmQueued.findMany({ where: { taskId } });
  for (const row of rows) {
    await deleteAlarm(row.name);
    await prisma.alarmQueued.delete({ where: { name: row.name } }).catch(() => {});
  }
}

/** Reconciliação diária: sincroniza todas as tarefas ativas de todos os usuários. */
export async function syncAllTasks(): Promise<{ synced: number; failed: number }> {
  const tasks = await prisma.task.findMany({ where: { active: true }, select: { id: true } });
  let synced = 0;
  let failed = 0;
  for (const t of tasks) {
    try {
      await syncAlarms(t.id);
      synced += 1;
    } catch (err) {
      failed += 1;
      console.error("[sync] falha ao sincronizar tarefa", t.id, err);
    }
  }
  return { synced, failed };
}
