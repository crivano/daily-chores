/**
 * Estados de uma tarefa no dia — funções PURAS, isomórficas (client + server).
 *
 * "NONE" = sem registro de Completion no dia. Os demais são os valores da
 * coluna Completion.status.
 *
 * Semântica:
 * - Conclusivos (param o alarme, contam no progresso, deslocam cadeias):
 *   DONE, HAPPY, INDIFFERENT, SAD (humores concluem e registram o sentimento).
 * - CANCELLED: silencia o alarme, mas não conta no progresso nem desloca
 *   cadeias (dependentes usam o horário nominal).
 */

export type TaskState = "NONE" | "DONE" | "CANCELLED" | "HAPPY" | "INDIFFERENT" | "SAD";

/** Ordem de rotação do controle (um toque avança um estado). */
export const STATE_CYCLE: TaskState[] = [
  "NONE",
  "DONE",
  "CANCELLED",
  "HAPPY",
  "INDIFFERENT",
  "SAD",
];

export interface StateMeta {
  /** Rótulo exibido ao usuário (pt-BR). */
  label: string;
  /** Conta como conclusão (progresso, cadeias, alarme). */
  conclusive: boolean;
}

export const STATE_META: Record<TaskState, StateMeta> = {
  NONE: { label: "Não feito", conclusive: false },
  DONE: { label: "Feito", conclusive: true },
  CANCELLED: { label: "Cancelado", conclusive: false },
  HAPPY: { label: "Feliz", conclusive: true },
  INDIFFERENT: { label: "Indiferente", conclusive: true },
  SAD: { label: "Triste", conclusive: true },
};

/** Valores válidos de Completion.status no banco (sem "NONE"). */
export const COMPLETION_STATUSES: TaskState[] = STATE_CYCLE.filter((s) => s !== "NONE");

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && STATE_CYCLE.includes(value as TaskState);
}

/** Próximo estado no ciclo de rotação. */
export function nextState(state: TaskState): TaskState {
  const i = STATE_CYCLE.indexOf(state);
  return STATE_CYCLE[(i + 1) % STATE_CYCLE.length];
}

/** Aceita o `status` bruto (string do banco) — valor desconhecido não conclui. */
export function isConclusive(status: string): boolean {
  return STATE_META[status as TaskState]?.conclusive === true;
}
