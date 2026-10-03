"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  taskId: string;
  name: string;
  completed: boolean;
  timeLabel?: string;
  shiftLabel?: string;
  note?: string;
}

/** Linha da lista do dia — checkbox grande + nome + badge de hora/shift. */
export function TaskCheckbox({ taskId, name, completed, timeLabel, shiftLabel, note }: Props) {
  const router = useRouter();
  const [checked, setChecked] = useState(completed);
  const [error, setError] = useState(false);

  // Sincroniza com o server quando o router.refresh() traz o novo estado.
  const [lastCompleted, setLastCompleted] = useState(completed);
  if (completed !== lastCompleted) {
    setLastCompleted(completed);
    setChecked(completed);
  }

  async function toggle() {
    const next = !checked;
    setChecked(next);
    setError(false);
    try {
      const res = await fetch("/api/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, done: next }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setChecked(!next); // rollback
      setError(true);
      setTimeout(() => setError(false), 3000);
    }
  }

  return (
    <li className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={checked}
        className={`flex min-h-16 w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm transition active:scale-[0.99] dark:bg-zinc-800 ${
          checked ? "opacity-50" : ""
        }`}
      >
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition ${
            checked
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-zinc-300 dark:border-zinc-600"
          }`}
        >
          {checked && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`truncate font-medium ${checked ? "line-through" : ""}`}>{name}</span>
          {note && <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{note}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {shiftLabel && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 tabular-nums dark:bg-zinc-700 dark:text-zinc-300">
              {shiftLabel}
            </span>
          )}
          {timeLabel && (
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 tabular-nums dark:bg-indigo-500/15 dark:text-indigo-300">
              {timeLabel}
            </span>
          )}
        </span>
      </button>
      {error && (
        <span className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white shadow">
          Não foi possível salvar
        </span>
      )}
    </li>
  );
}
