/**
 * Estados de uma tarefa no dia — funções PURAS, isomórficas (client + server).
 *
 * "NONE" = sem registro de Completion no dia. Os demais são os valores da
 * coluna Completion.status.
 *
 * Semântica:
 * - Conclusivos (param o alarme, contam no progresso, deslocam cadeias):
 *   DONE, HAPPY, INDIFFERENT, SAD (humores concluem e registram o sentimento)
 *   e BOMB (💣 "escapuli" — registrou a falha, ex.: estourou a dieta; a tarefa
 *   foi respondida, então o alarme para e a cadeia desloca no instante real).
 * - CANCELLED: silencia o alarme, mas não conta no progresso nem desloca
 *   cadeias (dependentes usam o horário nominal).
 *
 * Cada tarefa pode restringir quais estados aceita (Task.allowedStates): no
 * banco, ARRAY vazio = sem restrição (default; tarefas anteriores ao recurso);
 * array com valores = exatamente os estados marcáveis. "NONE" NÃO entra no
 * array: voltar a "não marcado" é sempre possível (apaga o Completion do dia).
 * No domínio/DTO, a ausência de restrição é representada como null
 * (AllowedStates) — a tradução banco↔domínio é normalizeAllowedStates.
 */

export type TaskState = "NONE" | "DONE" | "CANCELLED" | "HAPPY" | "INDIFFERENT" | "SAD" | "BOMB";

/** Ordem de rotação do controle (um toque avança um estado). */
export const STATE_CYCLE: TaskState[] = [
  "NONE",
  "DONE",
  "CANCELLED",
  "HAPPY",
  "INDIFFERENT",
  "SAD",
  "BOMB",
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
  BOMB: { label: "Bomba", conclusive: true },
};

/** Valores válidos de Completion.status no banco (sem "NONE"). */
export const COMPLETION_STATUSES: TaskState[] = STATE_CYCLE.filter((s) => s !== "NONE");

/**
 * Estados marcáveis de uma tarefa: null = sem restrição (todos), array =
 * exatamente os permitidos ("NONE" nunca entra — sempre disponível).
 */
export type AllowedStates = TaskState[] | null;

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

/** O estado pode ser gravado nesta tarefa? ("NONE" é sempre possível.) */
export function isStateAllowed(allowed: AllowedStates, state: TaskState): boolean {
  if (state === "NONE") return true;
  return allowed == null || allowed.includes(state);
}

/**
 * Próximo estado do ciclo de rotação pulando os não permitidos ("NONE" é
 * sempre permitido). Com nenhum estado marcável, devolve o próprio "NONE".
 */
export function nextStateAllowed(state: TaskState, allowed: AllowedStates): TaskState {
  let cur = state;
  for (let i = 0; i < STATE_CYCLE.length; i += 1) {
    cur = nextState(cur);
    if (cur === "NONE" || isStateAllowed(allowed, cur)) return cur;
  }
  return state; // defensivo (inalcançável: NONE fecha o ciclo em ≤ N passos)
}

/**
 * Normaliza um valor bruto (banco/API) para AllowedStates de DTO:
 * não-array OU array vazio → null (sem restrição — convenção do banco, onde
 * ARRAY vazio é o default histórico); array → valores válidos sem "NONE",
 * deduplicados na ordem canônica de COMPLETION_STATUSES. Lixo é descartado
 * silenciosamente — a API valida com erro; aqui só defensamos a exibição
 * (se após o filtro nada sobrar, degrada para null em vez de bloquear).
 */
export function normalizeAllowedStates(raw: unknown): AllowedStates {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const set = new Set<TaskState>();
  for (const v of raw) {
    if (isTaskState(v) && v !== "NONE") set.add(v);
  }
  return set.size === 0 ? null : COMPLETION_STATUSES.filter((s) => set.has(s));
}
