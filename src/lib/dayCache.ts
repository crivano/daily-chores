/**
 * Cache do dia em localStorage — client-only.
 * Chave única por usuário; payload por data ("YYYY-MM-DD"). Mantém as ~30 datas
 * mais recentes (poda por data desc). Versão no prefixo para invalidar em
 * mudanças de formato.
 */
import type { DayPayload } from "./domain/day";

const PREFIX = "dc:day:v1";
const MAX_DATES = 30;

function keyOf(userId: string): string {
  return `${PREFIX}:${userId}`;
}

function readAll(userId: string): Record<string, DayPayload> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(keyOf(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DayPayload>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // cache corrompido — ignora silenciosamente
  }
}

/** Payload cacheado da data (ou null). */
export function readDayCache(userId: string, D: string): DayPayload | null {
  const all = readAll(userId);
  const cached = all[D];
  return cached && cached.date === D ? cached : null;
}

/** Grava o payload da data e poda as entradas mais antigas. */
export function writeDayCache(userId: string, day: DayPayload): void {
  if (typeof window === "undefined") return;
  try {
    const all = readAll(userId);
    all[day.date] = day;
    const dates = Object.keys(all).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    for (const d of dates.slice(MAX_DATES)) delete all[d];
    window.localStorage.setItem(keyOf(userId), JSON.stringify(all));
  } catch {
    // quota cheia/disabled — cache é best-effort.
  }
}
