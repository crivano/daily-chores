"use client";

import { useState } from "react";

import type { DayTaskDTO } from "@/lib/domain/day";
import { STATE_META, nextState, type TaskState } from "@/lib/domain/states";

interface Props {
  task: DayTaskDTO;
  /** Aplica o novo estado; false = falhou (rollback já feito pelo pai). */
  onSetState: (next: TaskState) => Promise<boolean>;
  /** Ajusta a hora de conclusão ("HH:mm" local do dia); false = falhou. */
  onSetTime: (hhmm: string) => Promise<boolean>;
}

/** Ícone do estado (28px) — círculo, check, proibido ou humor. */
function StateIcon({ state }: { state: TaskState }) {
  const base = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg";
  switch (state) {
    case "DONE":
      return (
        <span aria-hidden className={`${base} border-2 border-indigo-600 bg-indigo-600 text-white`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 13 4 4L19 7" />
          </svg>
        </span>
      );
    case "CANCELLED":
      return (
        <span aria-hidden className={`${base} border-2 border-zinc-400 text-zinc-400 dark:border-zinc-500 dark:text-zinc-500`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="m5.5 5.5 13 13" />
          </svg>
        </span>
      );
    case "HAPPY":
    case "INDIFFERENT":
    case "SAD": {
      const emoji = state === "HAPPY" ? "😊" : state === "INDIFFERENT" ? "😐" : "😟";
      const tint =
        state === "HAPPY"
          ? "bg-emerald-100 dark:bg-emerald-500/15"
          : state === "INDIFFERENT"
            ? "bg-amber-100 dark:bg-amber-500/15"
            : "bg-rose-100 dark:bg-rose-500/15";
      return (
        <span aria-hidden className={`${base} ${tint} text-base leading-none`}>
          {emoji}
        </span>
      );
    }
    default:
      return (
        <span aria-hidden className={`${base} border-2 border-zinc-300 dark:border-zinc-600`} />
      );
  }
}

/**
 * Linha da lista do dia — controle rotativo de estado + nome + pills de
 * hora/shift + hora de conclusão editável (clique no pill abre o editor).
 */
export function TaskRow({ task, onSetState, onSetTime }: Props) {
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const meta = STATE_META[task.state];
  const next = nextState(task.state);
  const nextMeta = STATE_META[next];

  function flashError() {
    setError(true);
    setTimeout(() => setError(false), 3000);
  }

  async function cycle() {
    setError(false);
    const ok = await onSetState(next);
    if (!ok) flashError();
  }

  function openEditor() {
    setDraft(task.completedAtLabel ?? "");
    setEditing(true);
    setError(false);
  }

  async function saveTime() {
    if (!draft || busy) return;
    setBusy(true);
    const ok = await onSetTime(draft);
    setBusy(false);
    if (ok) setEditing(false);
    else flashError();
  }

  const conclusive = meta.conclusive;
  const dimmed = task.state === "DONE" || task.state === "CANCELLED";

  return (
    <li className="relative">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${task.name}: ${meta.label}. Toque para mudar para ${nextMeta.label.toLowerCase()}`}
        title={`${meta.label} — toque para mudar para ${nextMeta.label.toLowerCase()}`}
        onClick={cycle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            cycle();
          }
        }}
        className={`flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm transition active:scale-[0.99] dark:bg-zinc-800 ${
          dimmed ? "opacity-50" : ""
        }`}
      >
        <StateIcon state={task.state} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`truncate font-medium ${conclusive || task.state === "CANCELLED" ? "line-through" : ""}`}>
            {task.name}
          </span>
          {task.note && (
            <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{task.note}</span>
          )}
        </span>

        {editing ? (
          <span
            className="flex shrink-0 items-center gap-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <input
              type="time"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`Hora de conclusão de ${task.name}`}
              className="h-9 rounded-xl border border-zinc-300 bg-white px-2 text-xs tabular-nums dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={saveTime}
              disabled={!draft || busy}
              aria-label="Salvar hora"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 13 4 4L19 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="Cancelar edição"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 transition active:scale-[0.98] dark:bg-zinc-700 dark:text-zinc-300"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-4 w-4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5">
            {task.completedAtLabel && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditor();
                }}
                title="Ajustar hora de conclusão"
                aria-label={`Concluída às ${task.completedAtLabel}. Ajustar hora`}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums transition active:scale-[0.98] ${
                  conclusive
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                }`}
              >
                {task.completedAtLabel}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
              </button>
            )}
            {task.shiftLabel && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 tabular-nums dark:bg-zinc-700 dark:text-zinc-300">
                {task.shiftLabel}
              </span>
            )}
            {task.timeLabel && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 tabular-nums dark:bg-indigo-500/15 dark:text-indigo-300">
                {task.timeLabel}
              </span>
            )}
          </span>
        )}
      </div>
      {error && (
        <span className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white shadow">
          Não foi possível salvar
        </span>
      )}
    </li>
  );
}
