/** Formatações compartilhadas entre Server Components e ilhas client. */

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface TaskSummaryInfo {
  scheduleType: string;
  weekdays: number[];
  monthDay: number | null;
  time: string | null;
  anchorId: string | null;
  offsetMinutes: number | null;
}

/** "Seg, Qua, Sex" ou "Dia 15" */
export function recurrenceLabel(t: TaskSummaryInfo): string {
  if (t.scheduleType === "MONTHLY") return `Dia ${t.monthDay}`;
  const labels = [...t.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]);
  if (labels.length === 7) return "Todos os dias";
  return labels.join(", ") || "Sem dias";
}

/** "08:00 · relativa a Café" | "após Jantar · +20 min" | "sem hora" */
export function timeRuleLabel(t: TaskSummaryInfo, anchorName: string | null): string {
  if (t.time) {
    return anchorName ? `${t.time} · relativa a ${anchorName}` : t.time;
  }
  if (t.anchorId) {
    return anchorName
      ? `após ${anchorName}${t.offsetMinutes ? ` · +${t.offsetMinutes} min` : ""}`
      : "após tarefa";
  }
  return "sem hora fixa";
}

/** Converte "HH:mm" em minutos desde 00:00 (null se inválido). */
export function timeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Gap nominal em minutos entre duas horas "HH:mm" (positivo = depois da âncora). */
export function gapMinutes(time: string, anchorTime: string): number {
  return (timeToMinutes(time) ?? 0) - (timeToMinutes(anchorTime) ?? 0);
}
