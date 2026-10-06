import type { Task } from "@/generated/prisma/client";
import { timeToMinutes } from "./format";

/** Tarefa serializável para ilhas client (sem tipos do Prisma). */
export interface TaskDTO {
  id: string;
  name: string;
  active: boolean;
  scheduleType: "WEEKLY" | "MONTHLY";
  weekdays: number[];
  monthDay: number | null;
  time: string | null;
  anchorId: string | null;
  offsetMinutes: number | null;
  dependents: { id: string; name: string }[];
}

export function taskToDTO(task: Task, dependents: { id: string; name: string }[]): TaskDTO {
  return {
    id: task.id,
    name: task.name,
    active: task.active,
    scheduleType: task.scheduleType === "MONTHLY" ? "MONTHLY" : "WEEKLY",
    weekdays: [...task.weekdays],
    monthDay: task.monthDay,
    time: task.time,
    anchorId: task.anchorId,
    offsetMinutes: task.offsetMinutes,
    dependents,
  };
}

/**
 * Ordem da lista de configuração: tarefas sem hora fixa primeiro (A→Z pelo
 * nome), depois as com hora fixa em ordem cronológica (empate → A→Z).
 */
export function compareTaskDTOs(a: TaskDTO, b: TaskDTO): number {
  const am = timeToMinutes(a.time);
  const bm = timeToMinutes(b.time);
  if (am == null || bm == null) {
    if (am !== bm) return am == null ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR");
  }
  return am - bm || a.name.localeCompare(b.name, "pt-BR");
}

/** Constrói os DTOs com a lista de dependentes de cada tarefa. */
export function buildTaskDTOs(tasks: Task[]): TaskDTO[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dependents = new Map<string, { id: string; name: string }[]>();
  for (const t of tasks) {
    if (!t.anchorId) continue;
    const anchor = byId.get(t.anchorId);
    if (!anchor) continue;
    const list = dependents.get(anchor.id) ?? [];
    list.push({ id: t.id, name: t.name });
    dependents.set(anchor.id, list);
  }
  return tasks.map((t) => taskToDTO(t, dependents.get(t.id) ?? []));
}
