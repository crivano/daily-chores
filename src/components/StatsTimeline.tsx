"use client";

import type { ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { formatLocalDate, type StatsBucket, type StatusCounts } from "@/lib/domain/stats";
import { STATUS_COLORS, STATUS_ORDER } from "./statsColors";

/** Linha de dados do gráfico: contagens por status + taxa + rótulo do tooltip. */
type Entry = StatusCounts & {
  label: string;
  range: string;
  marked: number;
  rate: number | null;
};

function TimelineTooltip({ active, payload }: TooltipContentProps): ReactNode {
  const entry = payload?.[0]?.payload as Entry | undefined;
  if (!active || !entry) return null;
  const present = STATUS_ORDER.filter((k) => entry[k] > 0);
  return (
    <div className="min-w-36 rounded-xl bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
      <p className="mb-1 font-semibold text-zinc-800 dark:text-zinc-100">{entry.range}</p>
      {present.length > 0 ? (
        <ul className="space-y-0.5">
          {present.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[k].hex }}
              />
              <span className="text-zinc-600 dark:text-zinc-300">{STATUS_COLORS[k].label}</span>
              <span className="ml-auto pl-3 font-semibold text-zinc-800 tabular-nums dark:text-zinc-100">
                {entry[k]}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-500 dark:text-zinc-400">Sem marcações</p>
      )}
      <p className="mt-1 border-t border-zinc-100 pt-1 text-zinc-500 tabular-nums dark:border-zinc-700 dark:text-zinc-400">
        {entry.rate == null ? "sem previsão" : `${Math.round(entry.rate * 100)}% concluídas`}
      </p>
    </div>
  );
}

/**
 * Andamento do intervalo: barras empilhadas por status (eixo Y esquerdo) +
 * linha da taxa de conclusão em % (eixo Y direito). Cores de eixo/grade via
 * `currentColor` + classes no wrapper (funciona em dark mode sem JS).
 */
export function StatsTimeline({ buckets }: { buckets: StatsBucket[] }) {
  const data: Entry[] = buckets.map((b) => ({
    ...b.counts,
    label: b.label,
    range:
      b.start === b.end
        ? formatLocalDate(b.start, "d 'de' MMM")
        : `${formatLocalDate(b.start, "d MMM")} – ${formatLocalDate(b.end, "d MMM")}`,
    marked: b.marked,
    rate: b.rate,
  }));

  return (
    <div
      className="h-56 text-zinc-500 dark:text-zinc-400"
      role="img"
      aria-label="Andamento do intervalo: barras empilhadas por status e linha da taxa de conclusão"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke="currentColor"
            className="text-zinc-200 dark:text-zinc-700"
          />
          <XAxis
            dataKey="label"
            interval="preserveStartEnd"
            minTickGap={12}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "currentColor", className: "text-zinc-200 dark:text-zinc-700" }}
          />
          <YAxis
            yAxisId="marks"
            allowDecimals={false}
            width={28}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            domain={[0, 1]}
            ticks={[0, 0.5, 1]}
            tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
            width={36}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={TimelineTooltip} cursor={{ className: "fill-zinc-100 dark:fill-zinc-700/50" }} />
          {STATUS_ORDER.map((k) => (
            <Bar key={k} yAxisId="marks" dataKey={k} stackId="status" fill={STATUS_COLORS[k].hex} />
          ))}
          <Line
            yAxisId="rate"
            dataKey="rate"
            type="linear"
            stroke="currentColor"
            className="text-zinc-800 dark:text-zinc-100"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
