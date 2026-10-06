"use client";

import { useState } from "react";

/** Modo do seletor de intervalo. */
export type StatsMode = "week" | "month" | "custom";

interface Props {
  mode: StatsMode;
  /** Intervalo aplicado no momento ("YYYY-MM-DD"). */
  from: string;
  to: string;
  /** Hoje no fuso do usuário — teto dos inputs e âncora dos atalhos. */
  today: string;
  onShortcut: (mode: "week" | "month") => void;
  onOpenCustom: () => void;
  onCustom: (from: string, to: string) => void;
}

/**
 * Editor "Datas": rascunho local inicializado do intervalo aplicado. A chave
 * `${from}|${to}` remonta quando o intervalo aplicado muda — rascunho sempre
 * parte do estado real, sem effect de sincronização.
 */
function CustomRange({
  from,
  to,
  today,
  onApply,
}: {
  from: string;
  to: string;
  today: string;
  onApply: (from: string, to: string) => void;
}) {
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  function apply() {
    if (!draftFrom || !draftTo) return;
    let f = draftFrom;
    let t = draftTo;
    if (f > t) [f, t] = [t, f];
    if (t > today) t = today;
    if (f > t) f = t;
    setDraftFrom(f);
    setDraftTo(t);
    onApply(f, t);
  }

  const dateInput =
    "h-9 w-full rounded-xl border border-zinc-300 bg-white px-2 text-xs tabular-nums dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100";

  return (
    <div className="mt-2 flex items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">De</span>
        <input
          type="date"
          value={draftFrom}
          max={today}
          onChange={(e) => setDraftFrom(e.target.value)}
          className={dateInput}
        />
      </label>
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Até</span>
        <input
          type="date"
          value={draftTo}
          max={today}
          onChange={(e) => setDraftTo(e.target.value)}
          className={dateInput}
        />
      </label>
      <button
        type="button"
        disabled={!draftFrom || !draftTo}
        onClick={apply}
        className="h-9 shrink-0 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        Aplicar
      </button>
    </div>
  );
}

/**
 * Controle segmentado Semana/Mês/Datas. "Datas" revela dois inputs de data
 * (De/Até) + Aplicar; o pai decide o fetch — aqui só normalizamos o rascunho
 * (troca se De > Até, teto em hoje).
 */
export function StatsRangePicker({ mode, from, to, today, onShortcut, onOpenCustom, onCustom }: Props) {
  const segButton = (active: boolean) =>
    `flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
      active
        ? "bg-white text-indigo-600 shadow-sm dark:bg-zinc-700 dark:text-indigo-400"
        : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
    }`;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Intervalo das estatísticas"
        className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "week"}
          className={segButton(mode === "week")}
          onClick={() => onShortcut("week")}
        >
          Semana
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "month"}
          className={segButton(mode === "month")}
          onClick={() => onShortcut("month")}
        >
          Mês
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "custom"}
          className={segButton(mode === "custom")}
          onClick={onOpenCustom}
        >
          Datas
        </button>
      </div>

      {mode === "custom" && (
        <CustomRange key={`${from}|${to}`} from={from} to={to} today={today} onApply={onCustom} />
      )}
    </div>
  );
}
