"use client";

import type { TaskExerciseDTO } from "@/lib/dto";
import type { LoadUnit } from "@/lib/domain/workout";

/**
 * Rascunho de exercício no formulário — números como string para permitir o
 * campo vazio (= não se aplica). `key` é estável para o React mesmo em
 * exercícios novos (sem id).
 */
export interface ExerciseDraft {
  key: string;
  id: string | null;
  name: string;
  sets: string;
  reps: string;
  durationSec: string;
  load: string;
  loadUnit: LoadUnit;
  restSec: string;
  notes: string;
}

let seq = 0;
const newKey = () => `new-${Date.now()}-${(seq += 1)}`;

const str = (n: number | null) => (n == null ? "" : String(n));

export function draftFromDTO(e: TaskExerciseDTO): ExerciseDraft {
  return {
    key: e.id,
    id: e.id,
    name: e.name,
    sets: str(e.sets),
    reps: str(e.reps),
    durationSec: str(e.durationSec),
    load: e.load == null ? "" : String(e.load).replace(".", ","),
    loadUnit: e.loadUnit,
    restSec: str(e.restSec),
    notes: e.notes ?? "",
  };
}

export function emptyDraft(): ExerciseDraft {
  return {
    key: newKey(),
    id: null,
    name: "",
    sets: "3",
    reps: "10",
    durationSec: "",
    load: "",
    loadUnit: "kg",
    restSec: "60",
    notes: "",
  };
}

/** "" → null; aceita vírgula decimal ("22,5"). NaN vai como está — o servidor recusa com mensagem. */
export function parseNum(v: string): number | null {
  const t = v.trim().replace(",", ".");
  return t === "" ? null : Number(t);
}

/** Corpo enviado à API (a ordem do array é a ordem de exibição). */
export function draftToPayload(d: ExerciseDraft) {
  return {
    id: d.id,
    name: d.name.trim(),
    sets: parseNum(d.sets),
    reps: parseNum(d.reps),
    durationSec: parseNum(d.durationSec),
    load: parseNum(d.load),
    loadUnit: d.loadUnit,
    restSec: parseNum(d.restSec),
    notes: d.notes.trim() || null,
  };
}

interface Props {
  items: ExerciseDraft[];
  onChange: (items: ExerciseDraft[]) => void;
}

const smallLabel = "mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400";
const field =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900";

/** Editor da lista de exercícios de uma série: adicionar, alterar, reordenar, remover. */
export function ExerciseListEditor({ items, onChange }: Props) {
  function patch(index: number, changes: Partial<ExerciseDraft>) {
    onChange(items.map((it, i) => (i === index ? { ...it, ...changes } : it)));
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700";

  return (
    <div className="flex flex-col gap-3">
      {items.map((it, index) => (
        <div key={it.key} className="rounded-2xl bg-white p-3 shadow-sm dark:bg-zinc-800">
          <div className="mb-2 flex items-center gap-1">
            <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-zinc-400">{index + 1}.</span>
            <input
              className={`${field} flex-1`}
              value={it.name}
              onChange={(e) => patch(index, { name: e.target.value })}
              placeholder="Nome do exercício"
              maxLength={80}
              aria-label={`Nome do exercício ${index + 1}`}
            />
            <button type="button" className={iconBtn} onClick={() => move(index, -1)} disabled={index === 0} aria-label="Mover para cima">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              className={iconBtn}
              onClick={() => move(index, 1)}
              disabled={index === items.length - 1}
              aria-label="Mover para baixo"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className={`${iconBtn} hover:text-red-600 dark:hover:text-red-400`}
              onClick={() => remove(index)}
              aria-label={`Remover ${it.name || "exercício"}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={smallLabel}>Séries</label>
              <input className={field} inputMode="numeric" value={it.sets} onChange={(e) => patch(index, { sets: e.target.value })} />
            </div>
            <div>
              <label className={smallLabel}>Repetições</label>
              <input className={field} inputMode="numeric" value={it.reps} onChange={(e) => patch(index, { reps: e.target.value })} />
            </div>
            <div>
              <label className={smallLabel}>Tempo (s)</label>
              <input
                className={field}
                inputMode="numeric"
                value={it.durationSec}
                onChange={(e) => patch(index, { durationSec: e.target.value })}
              />
            </div>
            <div>
              <label className={smallLabel}>Carga</label>
              <input className={field} inputMode="decimal" value={it.load} onChange={(e) => patch(index, { load: e.target.value })} />
            </div>
            <div>
              <label className={smallLabel}>Unidade</label>
              <select
                className={field}
                value={it.loadUnit}
                onChange={(e) => patch(index, { loadUnit: e.target.value as LoadUnit })}
              >
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            </div>
            <div>
              <label className={smallLabel}>Descanso (s)</label>
              <input className={field} inputMode="numeric" value={it.restSec} onChange={(e) => patch(index, { restSec: e.target.value })} />
            </div>
          </div>
          <input
            className={`${field} mt-2`}
            value={it.notes}
            onChange={(e) => patch(index, { notes: e.target.value })}
            placeholder="Observação (opcional)"
            maxLength={300}
            aria-label="Observação"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...items, emptyDraft()])}
        className="flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-sm font-medium text-indigo-700 transition active:scale-[0.98] dark:border-zinc-600 dark:text-indigo-300"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Adicionar exercício
      </button>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Deixe em branco o que não se aplica (ex.: carga em exercícios com peso do corpo). Marcar todos os
        exercícios no dia conclui a tarefa.
      </p>
    </div>
  );
}
