/**
 * Estatísticas do intervalo — funções PURAS, isomórficas (client + server).
 * Preenchidas por getStatsPayload (src/lib/stats.ts) via GET /api/stats e
 * consumidas pelo StatsBoard.
 *
 * Convenções:
 * - Intervalo [from, to] em datas locais "YYYY-MM-DD", inclusive nas pontas.
 * - `due` ignora `active` (histórico de tarefas desativadas continua contando).
 * - Marcações em dia não previsto contam como marcação, mas não como devida.
 * - Status desconhecido no banco degrada para DONE (espelha stateOf em lib/day.ts).
 */
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

import {
  DEFAULT_TZ,
  addDays,
  due,
  isValidLocalDate,
  parseLocalDate,
  toLocalDate,
  type CompletionLike,
  type TaskLike,
} from "./schedule";
import { isConclusive, isTaskState, type TaskState } from "./states";

/** Status que existem como linha de Completion (TaskState sem "NONE"). */
export type MarkedStatus = Exclude<TaskState, "NONE">;

/** Ordem canônica de exibição (conclusivos primeiro, cancelado por último). */
export const STATUS_KEYS: MarkedStatus[] = ["DONE", "HAPPY", "INDIFFERENT", "SAD", "CANCELLED"];

export type StatusCounts = Record<MarkedStatus, number>;

function emptyCounts(): StatusCounts {
  return { DONE: 0, HAPPY: 0, INDIFFERENT: 0, SAD: 0, CANCELLED: 0 };
}

/** Total de marcações (soma de todos os status). */
export function markedOf(counts: StatusCounts): number {
  return STATUS_KEYS.reduce((sum, k) => sum + counts[k], 0);
}

/** Marcações em status conclusivo (DONE, HAPPY, INDIFFERENT, SAD). */
export function conclusivesOf(counts: StatusCounts): number {
  return STATUS_KEYS.filter((k) => isConclusive(k)).reduce((sum, k) => sum + counts[k], 0);
}

export interface StatsTask {
  taskId: string;
  name: string;
  counts: StatusCounts;
  marked: number; // marcações no intervalo (inclui dias não previstos)
  due: number; // vezes devida no intervalo, ignora `active`
  missed: number; // max(0, due − marked)
  conclusionRate: number; // conclusivos/due (0..1; 0 se due = 0)
}

/** Granularidade dos buckets do gráfico de andamento. */
export type BucketKind = "day" | "week" | "month";

export interface StatsBucket {
  label: string; // curto, para o eixo X ("seg", "5 out", "out 2026")
  start: string; // "YYYY-MM-DD" (útil para tooltip)
  end: string;
  due: number;
  counts: StatusCounts;
  marked: number;
  rate: number | null; // conclusivos/due; null quando nada devido no bucket
}

export interface StatsPayload {
  from: string;
  to: string;
  today: string; // "YYYY-MM-DD" de hoje no fuso do usuário
  days: number; // tamanho do intervalo, inclusive
  timezone: string;
  tzDefaulted: boolean; // usando DEFAULT_TZ (user.timezone nulo)
  bucketKind: BucketKind;
  totals: StatusCounts;
  totalDue: number;
  conclusionRate: number; // conclusivos/totalDue (0..1; 0 se totalDue = 0)
  tasks: StatsTask[]; // ordenado por marked desc → nome
  buckets: StatsBucket[];
}

// ---------------------------------------------------------------------------
// Datas pt-BR
// ---------------------------------------------------------------------------

/**
 * Formata uma data local "YYYY-MM-DD" sem depender do fuso de execução
 * (meio-dia UTC fixo — mesmo truque do dateLabel em lib/day.ts).
 */
export function formatLocalDate(D: string, fmt: string): string {
  const { y, m, d } = parseLocalDate(D);
  return formatInTimeZone(new Date(Date.UTC(y, m - 1, d, 12)), "UTC", fmt, { locale: ptBR });
}

/** Dias entre duas datas locais (b − a). */
export function diffDays(a: string, b: string): number {
  const pa = parseLocalDate(a);
  const pb = parseLocalDate(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000,
  );
}

// ---------------------------------------------------------------------------
// Validação/clamp do intervalo
// ---------------------------------------------------------------------------

const MAX_DAYS = 400; // teto do intervalo (inclusive)

export interface StatsRange {
  from: string;
  to: string;
}

/**
 * Normaliza o intervalo pedido:
 * - ausente/inválido → últimos 7 dias terminando hoje;
 * - `to` (ou ambos) no futuro → hoje;
 * - `from > to` → troca;
 * - mais de MAX_DAYS dias → `from` puxado para respeitar o teto.
 */
export function clampStatsRange(
  from: string | null | undefined,
  to: string | null | undefined,
  todayD: string,
): StatsRange {
  let f = from && isValidLocalDate(from) ? from : null;
  let t = to && isValidLocalDate(to) ? to : null;
  if (!t) t = todayD;
  if (!f) f = addDays(t, -6);
  if (f > t) [f, t] = [t, f];
  if (t > todayD) t = todayD;
  if (f > t) f = t; // ambos no futuro após o clamp
  if (diffDays(f, t) >= MAX_DAYS) f = addDays(t, -(MAX_DAYS - 1));
  return { from: f, to: t };
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

interface Segment {
  start: string;
  end: string;
}

function lastDayOf(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function bucketSegments(from: string, to: string, kind: BucketKind): Segment[] {
  const out: Segment[] = [];
  if (kind === "day") {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ start: d, end: d });
    return out;
  }
  if (kind === "week") {
    // Blocos de ≤7 dias terminando em `to` (o último fecha a janela).
    let end = to;
    while (end >= from) {
      const start = addDays(end, -6) < from ? from : addDays(end, -6);
      out.unshift({ start, end });
      end = addDays(start, -1);
    }
    return out;
  }
  // "month": meses calendário (primeiro/último podem ser parciais)
  let cur = from;
  while (cur <= to) {
    const { y, m } = parseLocalDate(cur);
    const monthEnd = toLocalDate(new Date(Date.UTC(y, m - 1, lastDayOf(y, m))));
    const end = monthEnd < to ? monthEnd : to;
    out.push({ start: cur, end });
    cur = addDays(end, 1);
  }
  return out;
}

function bucketKindOf(days: number): BucketKind {
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  return "month";
}

function bucketLabel(seg: Segment, kind: BucketKind, totalDays: number): string {
  if (kind === "day" && totalDays <= 7) return formatLocalDate(seg.start, "EEE").slice(0, 3); // "seg"
  if (kind === "month") return formatLocalDate(seg.start, "MMM yyyy");
  return formatLocalDate(seg.start, "d MMM"); // "5 out"
}

// ---------------------------------------------------------------------------
// Agregação
// ---------------------------------------------------------------------------

/**
 * Agrega marcações de [from, to] por status — global, por tarefa e por bucket.
 * Entradas inválidas são normalizadas por clampStatsRange. Tarefas entram se
 * devidas ≥ 1 vez ou com ≥ 1 marcação no intervalo.
 */
export function buildStatsPayload(
  tasks: TaskLike[],
  completions: CompletionLike[],
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
  todayD: string,
  timezone: string = DEFAULT_TZ,
  tzDefaulted: boolean = false,
): StatsPayload {
  const { from, to } = clampStatsRange(fromRaw, toRaw, todayD);
  const days = diffDays(from, to) + 1;
  const bucketKind = bucketKindOf(days);

  // status por tarefa por data (normalizado; desconhecido → DONE)
  const marksByTask = new Map<string, Map<string, MarkedStatus>>();
  for (const c of completions) {
    if (c.localDate < from || c.localDate > to) continue;
    const status: MarkedStatus = isTaskState(c.status) && c.status !== "NONE" ? c.status : "DONE";
    const byDate = marksByTask.get(c.taskId) ?? new Map<string, MarkedStatus>();
    byDate.set(c.localDate, status);
    marksByTask.set(c.taskId, byDate);
  }

  const buckets: StatsBucket[] = bucketSegments(from, to, bucketKind).map((seg) => ({
    label: bucketLabel(seg, bucketKind, days),
    start: seg.start,
    end: seg.end,
    due: 0,
    counts: emptyCounts(),
    marked: 0,
    rate: null,
  }));
  const bucketOf = new Map<string, number>();
  buckets.forEach((b, i) => {
    for (let d = b.start; d <= b.end; d = addDays(d, 1)) bucketOf.set(d, i);
  });

  const totals = emptyCounts();
  let totalDue = 0;
  const agg = new Map<string, { task: TaskLike; counts: StatusCounts; marked: number; due: number }>();

  for (const task of tasks) {
    const row = { task, counts: emptyCounts(), marked: 0, due: 0 };
    const marks = marksByTask.get(task.id);
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const bucket = buckets[bucketOf.get(d)!];
      if (due(task, d)) {
        row.due += 1;
        totalDue += 1;
        bucket.due += 1;
      }
      const status = marks?.get(d);
      if (status) {
        row.counts[status] += 1;
        row.marked += 1;
        totals[status] += 1;
        bucket.counts[status] += 1;
        bucket.marked += 1;
      }
    }
    agg.set(task.id, row);
  }

  for (const b of buckets) {
    b.rate = b.due > 0 ? Math.min(1, conclusivesOf(b.counts) / b.due) : null;
  }

  const statsTasks: StatsTask[] = [...agg.values()]
    .filter((r) => r.due >= 1 || r.marked >= 1)
    .map((r) => ({
      taskId: r.task.id,
      name: r.task.name,
      counts: r.counts,
      marked: r.marked,
      due: r.due,
      missed: Math.max(0, r.due - r.marked),
      conclusionRate: r.due > 0 ? Math.min(1, conclusivesOf(r.counts) / r.due) : 0,
    }))
    .sort((a, b) => b.marked - a.marked || a.name.localeCompare(b.name, "pt-BR"));

  return {
    from,
    to,
    today: todayD,
    days,
    timezone,
    tzDefaulted,
    bucketKind,
    totals,
    totalDue,
    conclusionRate: totalDue > 0 ? Math.min(1, conclusivesOf(totals) / totalDue) : 0,
    tasks: statsTasks,
    buckets,
  };
}
