/**
 * Mutações de tarefa (server-only) — compartilhadas pelas rotas REST
 * (/api/tasks) e pelo servidor MCP (/api/mcp). As regras continuam em
 * lib/tasks.ts (validação) e lib/exercises.ts (séries); aqui fica só a
 * orquestração: validar → gravar em transação → re-sincronizar alarmes.
 */
import { taskToDTO, type TaskDTO } from "./dto";
import { completeWorkoutAfterEdit, resolveExercisesInput, saveExercises } from "./exercises";
import { prisma } from "./prisma";
import { removeAllQueuedForTask, syncAlarms } from "./sync";
import { validateTaskInput, type TaskInput } from "./tasks";

export type ServiceFailure = { ok: false; status: number; message: string; dependents?: string[] };
export type ServiceResult<T> = { ok: true; data: T } | ServiceFailure;

type TaskBody = TaskInput & { exercises?: unknown };

/** Cria a tarefa (e a lista de exercícios, se série). */
export async function createTask(userId: string, body: TaskBody): Promise<ServiceResult<TaskDTO>> {
  const result = await validateTaskInput(userId, body);
  if (!result.ok) return result;

  // Série de exercícios: a lista completa vem junto (≥ 1 exercício).
  const exercises = await resolveExercisesInput(result.data.kind, body.exercises);
  if (!exercises.ok) return exercises;

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({ data: { userId, ...result.data } });
    if (exercises.data) await saveExercises(tx, created.id, exercises.data);
    return tx.task.findUniqueOrThrow({ where: { id: created.id }, include: { exercises: true } });
  });
  await syncAlarms(task.id).catch((err) => console.error("[sync] pós-criação", err));

  return { ok: true, data: taskToDTO(task, []) };
}

/** Patch da tarefa; `exercises` ausente = mantém a lista atual. */
export async function updateTask(userId: string, id: string, body: TaskBody): Promise<ServiceResult<TaskDTO>> {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.userId !== userId) return { ok: false, status: 404, message: "Tarefa não encontrada." };

  const result = await validateTaskInput(userId, body, task);
  if (!result.ok) return result;

  const exercises = await resolveExercisesInput(result.data.kind, body.exercises, id);
  if (!exercises.ok) return exercises;

  const dependents = await prisma.task.findMany({
    where: { anchorId: id },
    select: { id: true, name: true },
  });
  const updated = await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id }, data: result.data });
    if (exercises.data) {
      await saveExercises(tx, id, exercises.data);
      await completeWorkoutAfterEdit(tx, id);
    }
    return tx.task.findUniqueOrThrow({ where: { id }, include: { exercises: true } });
  });
  await syncAlarms(id).catch((err) => console.error("[sync] pós-update", err));

  return { ok: true, data: taskToDTO(updated, dependents) };
}

/** Exclui a tarefa. Âncora com dependentes é bloqueada (409 com os nomes). */
export async function deleteTask(userId: string, id: string): Promise<ServiceResult<null>> {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.userId !== userId) return { ok: false, status: 404, message: "Tarefa não encontrada." };

  const dependents = await prisma.task.findMany({ where: { anchorId: id }, select: { name: true } });
  if (dependents.length > 0) {
    return {
      ok: false,
      status: 409,
      message: `Não é possível excluir: ${dependents.length} tarefa(s) relativa(s) usam esta como âncora.`,
      dependents: dependents.map((d) => d.name),
    };
  }

  await removeAllQueuedForTask(id);
  await prisma.alarmDelivered.deleteMany({ where: { taskId: id } });
  await prisma.task.delete({ where: { id } }); // completions em cascata
  return { ok: true, data: null };
}
