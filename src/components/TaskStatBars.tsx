import type { StatsTask } from "@/lib/domain/stats";
import { MISSED_BAR, STATUS_COLORS, STATUS_ORDER } from "./statsColors";

/**
 * Lista de tarefas com barra horizontal empilhada (CSS puro — lida melhor com
 * nomes longos que um eixo de gráfico). Trilho cinza = dias faltantes;
 * segmentos coloridos = marcações por status. Barra cheia = todas as
 * ocorrências previstas.
 */
export function TaskStatBars({ tasks }: { tasks: StatsTask[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {tasks.map((t) => {
        // Base da barra: ocorrências previstas (marcações em dias não
        // previstos podem exceder — a barra nunca passa de 100%).
        const base = Math.max(t.due, t.marked);
        const width = (n: number) => `${base > 0 ? (n / base) * 100 : 0}%`;
        const detail = STATUS_ORDER.filter((k) => t.counts[k] > 0)
          .map((k) => `${STATUS_COLORS[k].label} ${t.counts[k]}`)
          .join(", ");
        const label = `${t.name}: ${t.marked} de ${t.due} previstas${
          detail ? ` (${detail})` : ""
        }${t.missed > 0 ? `, ${t.missed} faltante${t.missed > 1 ? "s" : ""}` : ""}`;
        return (
          <li key={t.taskId}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium">
                {t.time && (
                  <span className="shrink-0 text-xs font-semibold text-zinc-400 tabular-nums dark:text-zinc-500">
                    {t.time}
                  </span>
                )}
                <span className="truncate">{t.name}</span>
              </span>
              <span className="shrink-0 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                {t.marked} · {Math.round(t.conclusionRate * 100)}%
              </span>
            </div>
            <div
              className={`flex h-2.5 w-full overflow-hidden rounded-full ${MISSED_BAR}`}
              role="img"
              aria-label={label}
              title={label}
            >
              {STATUS_ORDER.map((k) =>
                t.counts[k] > 0 ? (
                  <div
                    key={k}
                    aria-hidden
                    className={STATUS_COLORS[k].bar}
                    style={{ width: width(t.counts[k]) }}
                  />
                ) : null,
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
