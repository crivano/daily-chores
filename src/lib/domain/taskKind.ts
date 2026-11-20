/**
 * Tipos de tarefa suportados pelo Daily Chores (isomórfico).
 * - SIMPLE: tarefa clássica de rotina;
 * - WORKOUT: série de exercícios com checklist e log diário;
 * - MEAL: refeição com cardápio estruturado para consulta rápida.
 */
export const TASK_KINDS = ["SIMPLE", "WORKOUT", "MEAL"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export function isTaskKind(v: unknown): v is TaskKind {
  return typeof v === "string" && (TASK_KINDS as readonly string[]).includes(v);
}
