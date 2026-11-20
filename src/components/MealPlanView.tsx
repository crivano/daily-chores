"use client";

import { useState } from "react";

import { countItemsWithSubstitutions, type MealItem, type MealPlan } from "@/lib/domain/meal";

interface Props {
  plan: MealPlan;
}

/**
 * Visualização de consulta rápida do cardápio de uma refeição (Task.kind = "MEAL")
 * dentro do TaskRow da tela Hoje:
 * - abas de variação quando há ≥ 2 opções (ex.: Jantar "Comida" | "Opção lanche");
 * - lista compacta com alimento principal + quantidade; tocar num item com
 *   substituições expande/recolhe as trocas equivalentes;
 * - observações da opção e observações gerais no rodapé.
 */
export function MealPlanView({ plan }: Props) {
  const [optionIdx, setOptionIdx] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const safeIdx = optionIdx < plan.options.length ? optionIdx : 0;
  const option = plan.options[safeIdx];
  if (!option) return null;

  const hasMultipleOptions = plan.options.length > 1;
  const itemsWithSubs = countItemsWithSubstitutions(option);

  const keyOf = (itemIdx: number) => `${safeIdx}:${itemIdx}`;
  const allSubsOpen =
    itemsWithSubs > 0 &&
    option.items.every((item, idx) => item.substitutions.length === 0 || Boolean(expanded[keyOf(idx)]));

  function toggleItem(itemIdx: number) {
    const key = keyOf(itemIdx);
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleAllSubs() {
    const target = !allSubsOpen;
    setExpanded((prev) => {
      const next = { ...prev };
      option.items.forEach((item, idx) => {
        if (item.substitutions.length > 0) next[keyOf(idx)] = target;
      });
      return next;
    });
  }

  const notesBlocks = [option.notes, plan.notes].filter((n): n is string => Boolean(n));

  return (
    <div
      className="flex flex-col gap-2.5 px-1 pb-1 pt-2"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {hasMultipleOptions && (
        <div
          role="tablist"
          aria-label="Opções de cardápio"
          data-swipe-ignore
          className="flex flex-wrap gap-1.5 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900/70"
        >
          {plan.options.map((opt, idx) => {
            const selected = idx === safeIdx;
            return (
              <button
                key={idx}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setOptionIdx(idx)}
                className={`min-h-8 flex-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  selected
                    ? "bg-white text-indigo-700 shadow-sm dark:bg-zinc-800 dark:text-indigo-300"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {opt.name ?? `Opção ${idx + 1}`}
              </button>
            );
          })}
        </div>
      )}

      {itemsWithSubs > 1 && (
        <div className="flex justify-end px-0.5">
          <button
            type="button"
            onClick={toggleAllSubs}
            className="text-[11px] font-medium text-indigo-600 transition hover:underline dark:text-indigo-400"
          >
            {allSubsOpen ? "Ocultar substituições" : "Ver todas as substituições"}
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {option.items.map((item, idx) => (
          <MealItemRow
            key={keyOf(idx)}
            item={item}
            open={Boolean(expanded[keyOf(idx)])}
            onToggle={() => toggleItem(idx)}
          />
        ))}
      </ul>

      {notesBlocks.length > 0 && (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Observações
          </p>
          <div className="flex flex-col gap-2">
            {notesBlocks.map((text, idx) => (
              <p key={idx} className="whitespace-pre-line">
                {text}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MealItemRow({
  item,
  open,
  onToggle,
}: {
  item: MealItem;
  open: boolean;
  onToggle: () => void;
}) {
  const subsCount = item.substitutions.length;
  const hasSubs = subsCount > 0;

  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-sm font-medium leading-snug text-zinc-900 dark:text-zinc-100">
          {item.food}
        </span>
        {item.quantity && (
          <span className="mt-0.5 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
            {item.quantity}
          </span>
        )}
      </span>
      {hasSubs && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
          <span className="tabular-nums">
            {subsCount} {subsCount === 1 ? "troca" : "trocas"}
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      )}
    </>
  );

  return (
    <li className="rounded-xl bg-zinc-50 dark:bg-zinc-900/60">
      {hasSubs ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center gap-3 p-2.5 text-left transition active:scale-[0.995]"
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-3 p-2.5">{content}</div>
      )}

      {hasSubs && open && (
        <div className="border-t border-zinc-200/80 px-3 pb-2.5 pt-2 dark:border-zinc-700/70">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Substituições
          </p>
          <ul className="flex flex-col gap-1.5">
            {item.substitutions.map((sub, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs leading-snug">
                <span aria-hidden className="mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-400">
                  ⇄
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{sub.food}</span>
                  {sub.quantity && (
                    <span className="text-zinc-500 dark:text-zinc-400"> — {sub.quantity}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
