"use client";

import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipContentProps } from "recharts";

import type { StatusCounts } from "@/lib/domain/stats";
import { STATUS_COLORS, STATUS_ORDER, type MarkedStatus } from "./statsColors";

interface Datum {
  key: MarkedStatus;
  value: number;
}

function DonutTooltip({ active, payload }: TooltipContentProps): ReactNode {
  const entry = payload?.[0]?.payload as Datum | undefined;
  if (!active || !entry) return null;
  const c = STATUS_COLORS[entry.key];
  return (
    <div className="rounded-xl bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
      <span aria-hidden className={`font-semibold ${c.text}`}>
        {c.glyph}
      </span>{" "}
      <span className="font-medium text-zinc-800 dark:text-zinc-100">{c.label}</span>
      <span className="ml-2 text-zinc-600 tabular-nums dark:text-zinc-300">
        {entry.value} marcaç{entry.value > 1 ? "ões" : "ão"}
      </span>
    </div>
  );
}

/** Rosca global de marcações por status, com o total no centro e legenda. */
export function StatsDonut({ totals, marked }: { totals: StatusCounts; marked: number }) {
  const data: Datum[] = STATUS_ORDER.filter((k) => totals[k] > 0).map((k) => ({
    key: k,
    value: totals[k],
  }));
  const legend = STATUS_ORDER.filter((k) => totals[k] > 0);
  const aria =
    marked === 0
      ? "Nenhuma marcação no intervalo"
      : `Distribuição das ${marked} marcações: ${data
          .map((d) => `${STATUS_COLORS[d.key].label} ${d.value}`)
          .join(", ")}`;

  return (
    <div>
      <div className="relative h-52" role="img" aria-label={aria}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Pie
              data={data}
              dataKey="value"
              nameKey="key"
              innerRadius="66%"
              outerRadius="90%"
              paddingAngle={data.length > 1 ? 2 : 0}
              strokeWidth={0}
              startAngle={90}
              endAngle={-270}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={STATUS_COLORS[d.key].hex} />
              ))}
            </Pie>
            <Tooltip content={DonutTooltip} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums">{marked}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">marcações</span>
        </div>
      </div>

      <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {legend.map((k) => (
          <li key={k} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <span aria-hidden className={`w-4 text-center font-semibold ${STATUS_COLORS[k].text}`}>
              {STATUS_COLORS[k].glyph}
            </span>
            <span>{STATUS_COLORS[k].label}</span>
            <span className="font-semibold text-zinc-800 tabular-nums dark:text-zinc-100">
              {totals[k]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
