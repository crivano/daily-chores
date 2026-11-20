"use client";

import { useState } from "react";

import {
  ITEM_NAME_MAX,
  ITEM_QUANTITY_MAX,
  type ShoppingItemDTO,
  type ShoppingPlaceDTO,
} from "@/lib/domain/shopping";

interface Props {
  item: ShoppingItemDTO;
  places: ShoppingPlaceDTO[];
  onToggle: (item: ShoppingItemDTO) => Promise<void>;
  onUpdate: (
    itemId: string,
    patch: { name: string; quantity: string | null; placeId?: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (itemId: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Linha da lista de compras: tocar no item marca/desmarca (passando entre
 * "A comprar" e "Marcados"); o botão de lápis abre o editor inline de nome,
 * quantidade e local.
 */
export function ShoppingItemRow({ item, places, onToggle, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(item.name);
  const [draftQty, setDraftQty] = useState(item.quantity ?? "");
  const [draftPlaceId, setDraftPlaceId] = useState(item.placeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTemp = item.id.startsWith("tmp-");

  function openEditor() {
    setDraftName(item.name);
    setDraftQty(item.quantity ?? "");
    setDraftPlaceId(item.placeId);
    setError(null);
    setEditing(true);
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || isTemp) return;
    const trimmedName = draftName.replace(/\s+/g, " ").trim();
    if (!trimmedName) {
      setError("Informe o nome do item.");
      return;
    }
    const trimmedQty = draftQty.replace(/\s+/g, " ").trim();
    setBusy(true);
    setError(null);
    const res = await onUpdate(item.id, {
      name: trimmedName,
      quantity: trimmedQty || null,
      ...(draftPlaceId !== item.placeId ? { placeId: draftPlaceId } : {}),
    });
    setBusy(false);
    if (res.ok) {
      setEditing(false);
    } else {
      setError(res.error ?? "Não foi possível salvar.");
    }
  }

  async function remove() {
    if (busy || isTemp) return;
    if (!window.confirm(`Excluir "${item.name}" da lista?`)) return;
    setBusy(true);
    setError(null);
    const res = await onDelete(item.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Não foi possível excluir.");
    }
  }

  const field =
    "h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900";
  const smallLabel =
    "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

  return (
    <li
      className={`rounded-2xl bg-white shadow-sm transition dark:bg-zinc-800 ${
        item.checked && !editing ? "opacity-60" : ""
      }`}
    >
      <div className="flex min-h-14 items-center gap-1 pr-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={item.checked}
          aria-label={`${item.name}: ${item.checked ? "marcado — toque para voltar para a lista de compras" : "não marcado — toque para marcar como comprado"}`}
          disabled={isTemp}
          onClick={() => void onToggle(item)}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left transition active:scale-[0.99] disabled:opacity-70"
        >
          <span
            aria-hidden
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition ${
              item.checked
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-zinc-300 dark:border-zinc-600"
            }`}
          >
            {item.checked && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3.5}
                className="h-4 w-4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 13 4 4L19 7" />
              </svg>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={`truncate font-medium ${item.checked ? "line-through" : ""}`}>
              {item.name}
            </span>
            {item.quantity && (
              <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {item.quantity}
              </span>
            )}
          </span>
        </button>

        {!isTemp && (
          <button
            type="button"
            onClick={() => (editing ? setEditing(false) : openEditor())}
            title={editing ? "Fechar edição" : "Editar item"}
            aria-label={`Editar ${item.name}`}
            aria-expanded={editing}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-100 active:scale-[0.98] dark:text-zinc-500 dark:hover:bg-zinc-700"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-4 w-4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
        )}
      </div>

      {editing && (
        <form
          onSubmit={save}
          className="flex flex-col gap-3 border-t border-zinc-100 px-4 pb-4 pt-3 dark:border-zinc-700/70"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`item-name-${item.id}`} className={smallLabel}>
                Item
              </label>
              <input
                id={`item-name-${item.id}`}
                className={field}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={ITEM_NAME_MAX}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor={`item-qty-${item.id}`} className={smallLabel}>
                Quantidade / obs.
              </label>
              <input
                id={`item-qty-${item.id}`}
                className={field}
                value={draftQty}
                onChange={(e) => setDraftQty(e.target.value)}
                placeholder="Ex.: 2 caixas, 1 kg…"
                maxLength={ITEM_QUANTITY_MAX}
              />
            </div>
          </div>

          {places.length > 1 && (
            <div>
              <label htmlFor={`item-place-${item.id}`} className={smallLabel}>
                Local
              </label>
              <select
                id={`item-place-${item.id}`}
                className={field}
                value={draftPlaceId}
                onChange={(e) => setDraftPlaceId(e.target.value)}
              >
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="mr-auto h-9 rounded-xl px-3 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              Excluir
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className="h-9 rounded-xl px-3 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-9 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
