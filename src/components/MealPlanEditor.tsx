"use client";

import type { MealPlan } from "@/lib/domain/meal";

export interface MealSubDraft {
  key: string;
  food: string;
  quantity: string;
}

export interface MealItemDraft {
  key: string;
  food: string;
  quantity: string;
  substitutions: MealSubDraft[];
}

export interface MealOptionDraft {
  key: string;
  name: string;
  items: MealItemDraft[];
  notes: string;
}

export interface MealPlanDraft {
  options: MealOptionDraft[];
  notes: string;
}

let seq = 0;
const newKey = (prefix: string) => `${prefix}-${Date.now()}-${(seq += 1)}`;

export function emptySubDraft(): MealSubDraft {
  return { key: newKey("sub"), food: "", quantity: "" };
}

export function emptyItemDraft(): MealItemDraft {
  return { key: newKey("item"), food: "", quantity: "", substitutions: [] };
}

export function emptyOptionDraft(name = ""): MealOptionDraft {
  return { key: newKey("opt"), name, items: [emptyItemDraft()], notes: "" };
}

export function emptyMealPlanDraft(): MealPlanDraft {
  return { options: [emptyOptionDraft()], notes: "" };
}

export function mealDraftFromDTO(plan: MealPlan): MealPlanDraft {
  return {
    notes: plan.notes ?? "",
    options: plan.options.map((opt) => ({
      key: newKey("opt"),
      name: opt.name ?? "",
      notes: opt.notes ?? "",
      items: opt.items.map((item) => ({
        key: newKey("item"),
        food: item.food,
        quantity: item.quantity ?? "",
        substitutions: item.substitutions.map((sub) => ({
          key: newKey("sub"),
          food: sub.food,
          quantity: sub.quantity ?? "",
        })),
      })),
    })),
  };
}

/** Corpo enviado à API/validador (limpa substituições totalmente vazias). */
export function mealDraftToPayload(draft: MealPlanDraft) {
  return {
    notes: draft.notes.trim() || null,
    options: draft.options.map((opt) => ({
      name: opt.name.trim() || null,
      notes: opt.notes.trim() || null,
      items: opt.items.map((item) => ({
        food: item.food.trim(),
        quantity: item.quantity.trim() || null,
        substitutions: item.substitutions
          .filter((s) => s.food.trim() || s.quantity.trim())
          .map((s) => ({
            food: s.food.trim(),
            quantity: s.quantity.trim() || null,
          })),
      })),
    })),
  };
}

interface Props {
  plan: MealPlanDraft;
  onChange: (plan: MealPlanDraft) => void;
}

const smallLabel = "mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400";
const field =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900";
const textarea =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900";
const iconBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700";

/**
 * Editor de cardápio no modal da tarefa: variações (ex.: Comida / Opção lanche),
 * itens principais com quantidade, substituições equivalentes e observações.
 */
export function MealPlanEditor({ plan, onChange }: Props) {
  const multipleOptions = plan.options.length > 1;

  function patchOption(optIdx: number, changes: Partial<MealOptionDraft>) {
    onChange({
      ...plan,
      options: plan.options.map((o, i) => (i === optIdx ? { ...o, ...changes } : o)),
    });
  }

  function moveOption(optIdx: number, delta: -1 | 1) {
    const target = optIdx + delta;
    if (target < 0 || target >= plan.options.length) return;
    const next = [...plan.options];
    [next[optIdx], next[target]] = [next[target], next[optIdx]];
    onChange({ ...plan, options: next });
  }

  function removeOption(optIdx: number) {
    if (plan.options.length <= 1) return;
    onChange({ ...plan, options: plan.options.filter((_, i) => i !== optIdx) });
  }

  function addOption() {
    // Se estamos saindo de 1 opção sem nome para 2, sugere um nome inicial na 1ª.
    const nextOptions =
      plan.options.length === 1 && !plan.options[0].name.trim()
        ? [{ ...plan.options[0], name: "Principal" }, emptyOptionDraft()]
        : [...plan.options, emptyOptionDraft()];
    onChange({ ...plan, options: nextOptions });
  }

  function patchItem(optIdx: number, itemIdx: number, changes: Partial<MealItemDraft>) {
    const opt = plan.options[optIdx];
    patchOption(optIdx, {
      items: opt.items.map((it, i) => (i === itemIdx ? { ...it, ...changes } : it)),
    });
  }

  function moveItem(optIdx: number, itemIdx: number, delta: -1 | 1) {
    const opt = plan.options[optIdx];
    const target = itemIdx + delta;
    if (target < 0 || target >= opt.items.length) return;
    const next = [...opt.items];
    [next[itemIdx], next[target]] = [next[target], next[itemIdx]];
    patchOption(optIdx, { items: next });
  }

  function removeItem(optIdx: number, itemIdx: number) {
    const opt = plan.options[optIdx];
    patchOption(optIdx, { items: opt.items.filter((_, i) => i !== itemIdx) });
  }

  function addItem(optIdx: number) {
    const opt = plan.options[optIdx];
    patchOption(optIdx, { items: [...opt.items, emptyItemDraft()] });
  }

  function patchSub(optIdx: number, itemIdx: number, subIdx: number, changes: Partial<MealSubDraft>) {
    const item = plan.options[optIdx].items[itemIdx];
    patchItem(optIdx, itemIdx, {
      substitutions: item.substitutions.map((s, i) => (i === subIdx ? { ...s, ...changes } : s)),
    });
  }

  function removeSub(optIdx: number, itemIdx: number, subIdx: number) {
    const item = plan.options[optIdx].items[itemIdx];
    patchItem(optIdx, itemIdx, {
      substitutions: item.substitutions.filter((_, i) => i !== subIdx),
    });
  }

  function addSub(optIdx: number, itemIdx: number) {
    const item = plan.options[optIdx].items[itemIdx];
    patchItem(optIdx, itemIdx, {
      substitutions: [...item.substitutions, emptySubDraft()],
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {plan.options.map((opt, optIdx) => (
        <div
          key={opt.key}
          className={`flex flex-col gap-3 ${
            multipleOptions
              ? "rounded-2xl border border-zinc-200 bg-zinc-100/70 p-3 dark:border-zinc-700 dark:bg-zinc-800/40"
              : ""
          }`}
        >
          {multipleOptions && (
            <div className="flex items-center gap-1">
              <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                Opção {optIdx + 1}
              </span>
              <input
                className={`${field} ml-1 flex-1`}
                value={opt.name}
                onChange={(e) => patchOption(optIdx, { name: e.target.value })}
                placeholder="Ex.: Comida, Opção lanche…"
                maxLength={60}
                aria-label={`Nome da variação ${optIdx + 1}`}
              />
              <button
                type="button"
                className={iconBtn}
                onClick={() => moveOption(optIdx, -1)}
                disabled={optIdx === 0}
                aria-label="Mover variação para cima"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m18 15-6-6-6 6" />
                </svg>
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={() => moveOption(optIdx, 1)}
                disabled={optIdx === plan.options.length - 1}
                aria-label="Mover variação para baixo"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                className={`${iconBtn} hover:text-red-600 dark:hover:text-red-400`}
                onClick={() => removeOption(optIdx)}
                aria-label={`Remover variação ${opt.name || optIdx + 1}`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" />
                </svg>
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {opt.items.map((item, itemIdx) => (
              <div key={item.key} className="rounded-2xl bg-white p-3 shadow-sm dark:bg-zinc-800">
                <div className="mb-2 flex items-center gap-1">
                  <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-zinc-400">
                    {itemIdx + 1}.
                  </span>
                  <input
                    className={`${field} flex-1`}
                    value={item.food}
                    onChange={(e) => patchItem(optIdx, itemIdx, { food: e.target.value })}
                    placeholder="Alimento principal (ex.: Batata doce cozida)"
                    maxLength={140}
                    aria-label={`Alimento do item ${itemIdx + 1}`}
                  />
                  <button
                    type="button"
                    className={iconBtn}
                    onClick={() => moveItem(optIdx, itemIdx, -1)}
                    disabled={itemIdx === 0}
                    aria-label="Mover item para cima"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m18 15-6-6-6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    onClick={() => moveItem(optIdx, itemIdx, 1)}
                    disabled={itemIdx === opt.items.length - 1}
                    aria-label="Mover item para baixo"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`${iconBtn} hover:text-red-600 dark:hover:text-red-400`}
                    onClick={() => removeItem(optIdx, itemIdx)}
                    aria-label={`Remover ${item.food || "item"}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" />
                    </svg>
                  </button>
                </div>

                <input
                  className={field}
                  value={item.quantity}
                  onChange={(e) => patchItem(optIdx, itemIdx, { quantity: e.target.value })}
                  placeholder="Quantidade (opcional — ex.: 3 fatias pequenas (120g))"
                  maxLength={120}
                  aria-label={`Quantidade do item ${itemIdx + 1}`}
                />

                {item.substitutions.length > 0 && (
                  <div className="mt-2.5 flex flex-col gap-1.5 border-t border-zinc-100 pt-2.5 dark:border-zinc-700/70">
                    <span className={smallLabel}>Substituições</span>
                    {item.substitutions.map((sub, subIdx) => (
                      <div key={sub.key} className="flex items-start gap-1.5">
                        <div className="grid flex-1 grid-cols-1 gap-1.5 sm:grid-cols-2">
                          <input
                            className="h-9 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 text-xs outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
                            value={sub.food}
                            onChange={(e) => patchSub(optIdx, itemIdx, subIdx, { food: e.target.value })}
                            placeholder="Substituição (ex.: Arroz branco)"
                            maxLength={140}
                            aria-label={`Substituição ${subIdx + 1}`}
                          />
                          <input
                            className="h-9 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 text-xs outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
                            value={sub.quantity}
                            onChange={(e) => patchSub(optIdx, itemIdx, subIdx, { quantity: e.target.value })}
                            placeholder="Quantidade (opcional)"
                            maxLength={120}
                            aria-label={`Quantidade da substituição ${subIdx + 1}`}
                          />
                        </div>
                        <button
                          type="button"
                          className={`${iconBtn} h-9 hover:text-red-600 dark:hover:text-red-400`}
                          onClick={() => removeSub(optIdx, itemIdx, subIdx)}
                          aria-label={`Remover substituição ${sub.food || subIdx + 1}`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5" strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => addSub(optIdx, itemIdx)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 transition hover:underline dark:text-indigo-400"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Adicionar substituição
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => addItem(optIdx)}
            className="flex h-10 items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-xs font-semibold text-indigo-700 transition active:scale-[0.98] dark:border-zinc-600 dark:text-indigo-300"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Adicionar item
          </button>

          <div>
            <label className={smallLabel}>
              {multipleOptions ? `Observações (${opt.name.trim() || `Opção ${optIdx + 1}`})` : "Observações (opcional)"}
            </label>
            <textarea
              rows={2}
              className={textarea}
              value={opt.notes}
              onChange={(e) => patchOption(optIdx, { notes: e.target.value })}
              placeholder="Ex.: suplementos, ordem de consumo, preparo…"
              maxLength={1500}
            />
          </div>
        </div>
      ))}

      {multipleOptions && (
        <div>
          <label className={smallLabel}>Observações gerais da refeição (opcional)</label>
          <textarea
            rows={2}
            className={textarea}
            value={plan.notes}
            onChange={(e) => onChange({ ...plan, notes: e.target.value })}
            placeholder="Valem para todas as variações"
            maxLength={1500}
          />
        </div>
      )}

      <button
        type="button"
        onClick={addOption}
        className="flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 text-sm font-medium text-indigo-700 transition active:scale-[0.98] dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Adicionar variação de cardápio
      </button>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Use variações quando a mesma refeição tiver cardápios alternativos (ex.: Jantar &quot;Comida&quot; e
        &quot;Opção lanche&quot;). Na tela Hoje, tocar na refeição abre o cardápio para consulta rápida.
      </p>
    </div>
  );
}
