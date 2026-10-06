/**
 * Cores e rótulos por status para as seções de estatísticas.
 * Classes Tailwind LITERAIS (o scanner do v4 só enxerga strings completas);
 * `hex` alimenta os SVG do recharts, que não aceita classes.
 */
import type { TaskState } from "@/lib/domain/states";
import { STATE_META } from "@/lib/domain/states";

export type MarkedStatus = Exclude<TaskState, "NONE">;

export interface StatusColor {
  label: string; // "Feito" (mesma fonte do resto do app)
  glyph: string; // ✓ / 😊 / 😐 / 😟 / ⊘
  hex: string; // fill dos SVGs (recharts)
  bar: string; // classe do segmento de barra CSS
  text: string; // classe de texto da legenda
}

/** Ordem canônica de exibição (conclusivos primeiro, cancelado por último). */
export const STATUS_ORDER: MarkedStatus[] = ["DONE", "HAPPY", "INDIFFERENT", "SAD", "CANCELLED"];

export const STATUS_COLORS: Record<MarkedStatus, StatusColor> = {
  DONE: {
    label: STATE_META.DONE.label,
    glyph: "✓",
    hex: "#6366f1", // indigo-500
    bar: "bg-indigo-500",
    text: "text-indigo-600 dark:text-indigo-400",
  },
  HAPPY: {
    label: STATE_META.HAPPY.label,
    glyph: "😊",
    hex: "#10b981", // emerald-500
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  INDIFFERENT: {
    label: STATE_META.INDIFFERENT.label,
    glyph: "😐",
    hex: "#f59e0b", // amber-500
    bar: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  SAD: {
    label: STATE_META.SAD.label,
    glyph: "😟",
    hex: "#f43f5e", // rose-500
    bar: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
  },
  CANCELLED: {
    label: STATE_META.CANCELLED.label,
    glyph: "⊘",
    hex: "#a1a1aa", // zinc-400
    bar: "bg-zinc-400",
    text: "text-zinc-500 dark:text-zinc-400",
  },
};

/** Segmento "faltantes" das barras por tarefa (fundo do trilho). */
export const MISSED_BAR = "bg-zinc-200 dark:bg-zinc-700";
