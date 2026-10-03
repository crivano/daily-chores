/**
 * Domínio de agendamento — funções PURAS, única fonte de verdade.
 * Usado pela UI (Server Components), pelo disparador de alarmes (/api/internal/alarm)
 * e pela reconciliação (/api/internal/reconcile).
 *
 * Convenções:
 * - D = data local "YYYY-MM-DD" no fuso do usuário (tz IANA).
 * - `time` = "HH:mm". Timestamps são Date UTC.
 * - Toda conversão local↔UTC usa date-fns-tz (DST-correct).
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TZ = "America/Sao_Paulo";

export type AlarmKind = "NOMINAL" | "SHIFTED";

export interface TaskLike {
  id: string;
  name: string;
  active: boolean;
  scheduleType: string; // "WEEKLY" | "MONTHLY"
  weekdays: number[]; // 0=domingo … 6=sábado (JS getDay)
  monthDay: number | null; // 1..31
  time: string | null; // "HH:mm"
  anchorId: string | null;
  offsetMinutes: number | null;
}

export interface CompletionLike {
  taskId: string;
  localDate: string;
  completedAt: Date; // timestamp real do clique (UTC)
}

export type TasksById = Map<string, TaskLike>;
export type CompletionsByTask = Map<string, CompletionLike>;

const MS_PER_MINUTE = 60_000;
/** Guarda-fio contra cadeias ciclicas (a validação de API já bloqueia ciclos). */
const MAX_CHAIN_DEPTH = 32;

// ---------------------------------------------------------------------------
// Aritmética de datas locais "YYYY-MM-DD" (sem fuso — dias calendário)
// ---------------------------------------------------------------------------

export function parseLocalDate(D: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(D);
  if (!m) throw new Error(`Data local inválida: ${D}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function utcOf(D: string): Date {
  const { y, m, d } = parseLocalDate(D);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toLocalDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(D: string, n: number): string {
  const { y, m, d } = parseLocalDate(D);
  return toLocalDate(new Date(Date.UTC(y, m - 1, d + n)));
}

export function weekdayOf(D: string): number {
  return utcOf(D).getUTCDay();
}

export function dayOfMonth(D: string): number {
  return parseLocalDate(D).d;
}

/** Data local ("YYYY-MM-DD") de um instante, no fuso indicado. */
export function dateInTZ(dt: Date, tz: string): string {
  return formatInTimeZone(dt, tz, "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// due / nominal / shift / effective
// ---------------------------------------------------------------------------

/** A tarefa ocorre na data local D? (dia 31 em mês sem 31 → não ocorre) */
export function due(task: TaskLike, D: string): boolean {
  if (task.scheduleType === "MONTHLY") {
    return task.monthDay != null && dayOfMonth(D) === task.monthDay;
  }
  return task.weekdays.includes(weekdayOf(D));
}

/** Instante UTC do horário nominal na data D (D + task.time no fuso do usuário). */
export function nominal(task: TaskLike, D: string, tz: string): Date | undefined {
  if (!task.time) return undefined;
  return fromZonedTime(`${D}T${task.time}:00`, tz);
}

/**
 * Deslocamento (ms) da tarefa em D:
 * - 0 se sem âncora.
 * - Se a âncora A tem Completion em D: completedAt(A) − nominal(A, D)
 *   (positivo = atraso, negativo = adiantamento; herda recursivamente).
 * - Âncora com horário pendente → shift da própria âncora (cadeia).
 */
export function shiftOf(
  task: TaskLike,
  D: string,
  tz: string,
  completions: CompletionsByTask,
  tasksById: TasksById,
  depth = 0,
): number {
  if (!task.anchorId || depth >= MAX_CHAIN_DEPTH) return 0;
  const anchor = tasksById.get(task.anchorId);
  if (!anchor) return 0;
  const done = completions.get(anchor.id);
  const nomAnchor = nominal(anchor, D, tz);
  if (done && nomAnchor) {
    return done.completedAt.getTime() - nomAnchor.getTime();
  }
  return shiftOf(anchor, D, tz, completions, tasksById, depth + 1);
}

/**
 * Horário efetivo (instante UTC do alarme) ou undefined se a tarefa não alarma:
 * (a) sem âncora, com hora → nominal;
 * (b) com hora, âncora concluída → nominal(task) + (completedAt(A) − nominal(A))
 *     [equivale a completedAt(A) + gap nominal];
 * (c) com hora, âncora pendente → nominal(task) + shift(A) (provisório; a UI exibe);
 * (d) sem hora, âncora concluída → completedAt(A) + offsetMinutes;
 * (e) sem hora, âncora pendente → undefined (não alarma; UI mostra "após {âncora}").
 * Tarefa sem hora e sem âncora → undefined (nunca alarma).
 */
export function effectiveAt(
  task: TaskLike,
  D: string,
  tz: string,
  completions: CompletionsByTask,
  tasksById: TasksById,
): Date | undefined {
  if (!task.anchorId) {
    return task.time ? nominal(task, D, tz) : undefined;
  }
  const anchor = tasksById.get(task.anchorId);
  if (!anchor) {
    // Âncora não encontrada ( excluída/de outro usuário): degrada para o nominal.
    return task.time ? nominal(task, D, tz) : undefined;
  }
  if (task.time) {
    const nom = nominal(task, D, tz);
    if (!nom) return undefined;
    return new Date(nom.getTime() + shiftOf(task, D, tz, completions, tasksById));
  }
  const done = completions.get(anchor.id);
  if (!done) return undefined;
  return new Date(done.completedAt.getTime() + (task.offsetMinutes ?? 0) * MS_PER_MINUTE);
}

// ---------------------------------------------------------------------------
// Ocorrências futuras
// ---------------------------------------------------------------------------

/** Menor D′ > afterD com due(task, D′). Busca incremental até 400 dias. */
export function nextOccurrence(task: TaskLike, afterD: string): string | null {
  for (let i = 1; i <= 400; i += 1) {
    const D = addDays(afterD, i);
    if (due(task, D)) return D;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nomes de alarme (determinísticos) e formatação
// ---------------------------------------------------------------------------

/** Name do task no Cloud Tasks. O epoch evita colisão com nomes de versões antigas. */
export function alarmName(taskId: string, localDate: string, at: Date): string {
  return `alarm-${taskId}-${localDate}-${at.getTime()}`;
}

/** Pill de deslocamento: "+5 min" / "−10 min" (sinal menos U+2212). Vazio se 0. */
export function formatShift(shiftMs: number): string {
  const mins = Math.round(shiftMs / MS_PER_MINUTE);
  if (mins === 0) return "";
  return `${mins > 0 ? "+" : "−"}${Math.abs(mins)} min`;
}
