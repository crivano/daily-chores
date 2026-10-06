/**
 * Evento global (window) para sinalizar que os dados do dia mudaram fora do
 * DayBoard (ex.: AlarmOverlay concluiu, TimezoneSender gravou o fuso).
 * O DayBoard escuta e recarrega o payload.
 */
export const DAY_CHANGED_EVENT = "dc:day-changed";

export function notifyDayChanged(): void {
  window.dispatchEvent(new Event(DAY_CHANGED_EVENT));
}
