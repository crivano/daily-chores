"use client";

import { useState } from "react";

import type { DayExerciseDTO, DayWorkoutDTO } from "@/lib/domain/day";
import { exerciseSummary, formatSeconds, type ExerciseValues, type LoadUnit } from "@/lib/domain/workout";
import { parseNum } from "./ExerciseListEditor";

export interface ExerciseMutation {
  done?: boolean;
  values?: Partial<ExerciseValues>;
}

interface Props {
  workout: DayWorkoutDTO;
  /** Hoje: ajustes de valores passam a valer para os próximos treinos. */
  today: boolean;
  /** Aplica a mudança; false = falhou (rollback já feito pelo pai). */
  onMutate: (exerciseId: string, m: ExerciseMutation) => Promise<boolean>;
}

/**
 * Lista de exercícios de uma série no dia: um checkbox por exercício + editor
 * inline dos valores executados (séries, repetições, tempo, carga).
 */
export function WorkoutExercises({ workout, today, onMutate }: Props) {
  return (
    <ul className="flex flex-col gap-1.5 px-1 pb-1 pt-2">
      {workout.exercises.map((e) => (
        <ExerciseItem key={e.exerciseId} exercise={e} today={today} onMutate={onMutate} />
      ))}
    </ul>
  );
}

function ExerciseItem({
  exercise: e,
  today,
  onMutate,
}: {
  exercise: DayExerciseDTO;
  today: boolean;
  onMutate: Props["onMutate"];
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ sets: "", reps: "", durationSec: "", load: "", loadUnit: "kg" as LoadUnit });

  const summary = exerciseSummary(e);
  const extra = [e.restSec != null ? `descanso ${formatSeconds(e.restSec)}` : null, e.notes].filter(Boolean).join(" · ");

  function flashError() {
    setError(true);
    setTimeout(() => setError(false), 3000);
  }

  async function toggle() {
    if (busy) return;
    const ok = await onMutate(e.exerciseId, { done: !e.done });
    if (!ok) flashError();
  }

  function openEditor() {
    const s = (n: number | null) => (n == null ? "" : String(n));
    setDraft({
      sets: s(e.sets),
      reps: s(e.reps),
      durationSec: s(e.durationSec),
      load: e.load == null ? "" : String(e.load).replace(".", ","),
      loadUnit: e.loadUnit,
    });
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    const ok = await onMutate(e.exerciseId, {
      values: {
        sets: parseNum(draft.sets),
        reps: parseNum(draft.reps),
        durationSec: parseNum(draft.durationSec),
        load: parseNum(draft.load),
        loadUnit: draft.loadUnit,
      },
    });
    setBusy(false);
    if (ok) setEditing(false);
    else flashError();
  }

  const field =
    "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm tabular-nums outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900";
  const small = "mb-0.5 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400";

  return (
    <li className="relative rounded-xl bg-zinc-50 dark:bg-zinc-900/60">
      <div className="flex items-center gap-3 p-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={e.done}
          aria-label={`${e.name}: ${e.done ? "feito — toque para desmarcar" : "marcar como feito"}`}
          onClick={toggle}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition active:scale-95 ${
            e.done ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-600"
          }`}
        >
          {e.done && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          )}
        </button>
        <span className={`flex min-w-0 flex-1 flex-col ${e.done ? "opacity-60" : ""}`}>
          <span className={`truncate text-sm font-medium ${e.done ? "line-through" : ""}`}>
            {e.name}
            {e.archived && <span className="ml-1 text-xs font-normal text-zinc-400">(removido)</span>}
          </span>
          {summary && <span className="truncate text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{summary}</span>}
          {extra && <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{extra}</span>}
        </span>
        {e.doneAtLabel && (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            {e.doneAtLabel}
          </span>
        )}
        {/* Dia passado sem registro: não há o que corrigir (o plano só muda hoje). */}
        {!e.archived && (today || e.done) && (
          <button
            type="button"
            onClick={() => (editing ? setEditing(false) : openEditor())}
            title="Ajustar valores"
            aria-label={`Ajustar valores de ${e.name}`}
            aria-expanded={editing}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-200/70 active:scale-[0.98] dark:text-zinc-500 dark:hover:bg-zinc-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
        )}
      </div>

      {editing && (
        <div className="border-t border-zinc-200 p-2.5 dark:border-zinc-700">
          <div className="grid grid-cols-5 gap-1.5">
            <div>
              <label className={small}>Séries</label>
              <input className={field} inputMode="numeric" value={draft.sets} onChange={(ev) => setDraft({ ...draft, sets: ev.target.value })} />
            </div>
            <div>
              <label className={small}>Reps</label>
              <input className={field} inputMode="numeric" value={draft.reps} onChange={(ev) => setDraft({ ...draft, reps: ev.target.value })} />
            </div>
            <div>
              <label className={small}>Tempo (s)</label>
              <input
                className={field}
                inputMode="numeric"
                value={draft.durationSec}
                onChange={(ev) => setDraft({ ...draft, durationSec: ev.target.value })}
              />
            </div>
            <div>
              <label className={small}>Carga</label>
              <input className={field} inputMode="decimal" value={draft.load} onChange={(ev) => setDraft({ ...draft, load: ev.target.value })} />
            </div>
            <div>
              <label className={small}>Unid.</label>
              <select
                className={field}
                value={draft.loadUnit}
                onChange={(ev) => setDraft({ ...draft, loadUnit: ev.target.value as LoadUnit })}
              >
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <p className="flex-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {today ? "Vale para os próximos treinos." : "Corrige só o registro deste dia."}
            </p>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-9 rounded-lg px-3 text-xs font-medium text-zinc-600 dark:text-zinc-300"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-9 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <span className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white shadow">
          Não foi possível salvar
        </span>
      )}
    </li>
  );
}
