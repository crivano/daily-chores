"use client";

import { useState } from "react";

import {
  PLACE_NAME_MAX,
  countPending,
  type ShoppingPayload,
  type ShoppingPlaceDTO,
} from "@/lib/domain/shopping";

interface Props {
  places: ShoppingPlaceDTO[];
  onClose: () => void;
  onChanged: (shopping: ShoppingPayload, opts?: { selectPlaceId?: string }) => void;
}

/**
 * Modal de configuração dos locais de compra (Supermercado, Feira, Farmácia…):
 * criar, renomear, reordenar e excluir.
 */
export function ShoppingPlacesModal({ places, onClose, onChanged }: Props) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPlace(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cleaned = newName.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      setError("Informe o nome do local.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shopping/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleaned }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        place?: ShoppingPlaceDTO;
        shopping?: ShoppingPayload;
        error?: string;
      };
      if (!res.ok || !json.shopping) {
        throw new Error(json.error ?? "Não foi possível criar o local.");
      }
      setNewName("");
      onChanged(json.shopping, json.place ? { selectPlaceId: json.place.id } : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o local.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(place: ShoppingPlaceDTO) {
    setEditingId(place.id);
    setEditName(place.name);
    setError(null);
  }

  async function saveEdit(placeId: string) {
    if (busy) return;
    const cleaned = editName.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      setError("Informe o nome do local.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shopping/places/${placeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleaned }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        shopping?: ShoppingPayload;
        error?: string;
      };
      if (!res.ok || !json.shopping) {
        throw new Error(json.error ?? "Não foi possível renomear o local.");
      }
      setEditingId(null);
      onChanged(json.shopping);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível renomear o local.");
    } finally {
      setBusy(false);
    }
  }

  async function movePlace(placeId: string, targetPosition: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shopping/places/${placeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: targetPosition }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        shopping?: ShoppingPayload;
        error?: string;
      };
      if (!res.ok || !json.shopping) {
        throw new Error(json.error ?? "Não foi possível reordenar os locais.");
      }
      onChanged(json.shopping);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reordenar os locais.");
    } finally {
      setBusy(false);
    }
  }

  async function removePlace(place: ShoppingPlaceDTO) {
    if (busy) return;
    const count = place.items.length;
    const msg =
      count > 0
        ? `Excluir "${place.name}" e seus ${count} ${count === 1 ? "item" : "itens"}?`
        : `Excluir o local "${place.name}"?`;
    if (!window.confirm(msg)) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shopping/places/${place.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as {
        shopping?: ShoppingPayload;
        error?: string;
      };
      if (!res.ok || !json.shopping) {
        throw new Error(json.error ?? "Não foi possível excluir o local.");
      }
      if (editingId === place.id) setEditingId(null);
      onChanged(json.shopping);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o local.");
    } finally {
      setBusy(false);
    }
  }

  const label =
    "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
  const input =
    "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-800";
  const iconBtn =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configurar locais"
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-zinc-50 shadow-xl dark:bg-zinc-900 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="font-semibold">Configurar locais</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            <form onSubmit={addPlace}>
              <label htmlFor="new-place-name" className={label}>
                Novo local
              </label>
              <div className="flex gap-2">
                <input
                  id="new-place-name"
                  className={`${input} flex-1`}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex.: Farmácia, Açougue, Padaria…"
                  maxLength={PLACE_NAME_MAX}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="h-11 shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
                >
                  Adicionar
                </button>
              </div>
            </form>

            {error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}

            <div>
              <span className={label}>Seus locais ({places.length})</span>
              {places.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  Nenhum local cadastrado ainda. Adicione o primeiro acima.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {places.map((place, index) => {
                    const pending = countPending(place);
                    const checked = place.items.length - pending;
                    const isEditing = editingId === place.id;
                    return (
                      <li
                        key={place.id}
                        className="rounded-2xl bg-white p-3.5 shadow-sm dark:bg-zinc-800"
                      >
                        {isEditing ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void saveEdit(place.id);
                            }}
                            className="flex items-center gap-2"
                          >
                            <input
                              className="h-10 min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              maxLength={PLACE_NAME_MAX}
                              aria-label={`Renomear ${place.name}`}
                              autoFocus
                            />
                            <button
                              type="submit"
                              disabled={busy}
                              aria-label="Salvar nome"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition active:scale-[0.98] disabled:opacity-50"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m5 13 4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              disabled={busy}
                              aria-label="Cancelar"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 transition active:scale-[0.98] dark:bg-zinc-700 dark:text-zinc-300"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round">
                                <path d="M6 6l12 12M18 6 6 18" />
                              </svg>
                            </button>
                          </form>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{place.name}</p>
                              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                {place.items.length === 0
                                  ? "Vazio"
                                  : `${pending} a comprar · ${checked} ${checked === 1 ? "marcado" : "marcados"}`}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => void movePlace(place.id, index - 1)}
                                disabled={busy || index === 0}
                                title="Mover para cima"
                                aria-label={`Mover ${place.name} para cima`}
                                className={iconBtn}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m18 15-6-6-6 6" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => void movePlace(place.id, index + 1)}
                                disabled={busy || index === places.length - 1}
                                title="Mover para baixo"
                                aria-label={`Mover ${place.name} para baixo`}
                                className={iconBtn}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m6 9 6 6 6-6" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => startEdit(place)}
                                disabled={busy}
                                title="Renomear"
                                aria-label={`Renomear ${place.name}`}
                                className={iconBtn}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => void removePlace(place)}
                                disabled={busy}
                                title="Excluir"
                                aria-label={`Excluir ${place.name}`}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-500/10"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-200 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-xl border border-zinc-300 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
