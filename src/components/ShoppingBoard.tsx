"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ITEM_NAME_MAX,
  countPending,
  countTotalPending,
  findDuplicateItem,
  matchCheckedSuggestions,
  normalizeKey,
  splitPlaceItems,
  validateItemName,
  type ShoppingItemDTO,
  type ShoppingPayload,
} from "@/lib/domain/shopping";
import {
  readLastPlaceId,
  readShoppingCache,
  writeLastPlaceId,
  writeShoppingCache,
} from "@/lib/shoppingCache";
import { ShoppingItemRow } from "./ShoppingItemRow";
import { ShoppingPlacesModal } from "./ShoppingPlacesModal";

interface PendingToggle {
  seq: number;
  checked: boolean;
  addedAt: string;
  checkedAt: string | null;
}

function mergePendingToggles(
  payload: ShoppingPayload,
  pending: Map<string, PendingToggle>,
  pendingTemps: ShoppingItemDTO[],
): ShoppingPayload {
  if (pending.size === 0 && pendingTemps.length === 0) return payload;
  return {
    places: payload.places.map((place) => {
      const patched = place.items.map((item) => {
        const p = pending.get(item.id);
        if (!p) return item;
        return { ...item, checked: p.checked, addedAt: p.addedAt, checkedAt: p.checkedAt };
      });
      const existingKeys = new Set(patched.map((i) => normalizeKey(i.name)));
      const extraTemps = pendingTemps.filter(
        (t) => t.placeId === place.id && !existingKeys.has(normalizeKey(t.name)),
      );
      const { unchecked, checked } = splitPlaceItems([...patched, ...extraTemps]);
      return { ...place, items: [...unchecked, ...checked] };
    }),
  };
}

/**
 * Painel da lista de compras (client): carrega do cache localStorage para
 * pintura imediata e revalida via GET /api/shopping.
 *
 * Cada local (Supermercado, Feira, etc.) mantém itens persistentes divididos
 * entre não marcados ("A comprar") e marcados ("Marcados"): quando um item
 * acaba em casa, basta desmarcá-lo para voltar ao topo de "A comprar".
 */
export function ShoppingBoard({ userId }: { userId: string }) {
  const [data, setData] = useState<ShoppingPayload | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [checkedOpen, setCheckedOpen] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dataRef = useRef<ShoppingPayload | null>(null);
  const pendingTogglesRef = useRef(new Map<string, PendingToggle>());
  const pendingTempsRef = useRef(new Map<string, ShoppingItemDTO>());
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }

  function commitData(next: ShoppingPayload) {
    dataRef.current = next;
    setData(next);
  }

  function applyServerShopping(fresh: ShoppingPayload) {
    writeShoppingCache(userId, fresh);
    commitData(
      mergePendingToggles(
        fresh,
        pendingTogglesRef.current,
        Array.from(pendingTempsRef.current.values()),
      ),
    );
  }

  const load = useCallback(
    async (opts?: { fromCache?: boolean }) => {
      if (opts?.fromCache) {
        const cached = readShoppingCache(userId);
        if (cached && !dataRef.current) commitData(cached);
        const lastPlace = readLastPlaceId(userId);
        if (lastPlace) setSelectedPlaceId(lastPlace);
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoadError(false);

      try {
        const res = await fetch("/api/shopping", {
          signal: ac.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const fresh = (await res.json()) as ShoppingPayload;
        if (ac.signal.aborted) return;
        applyServerShopping(fresh);
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || ac.signal.aborted) return;
        if (!dataRef.current) setLoadError(true);
      }
    },
    // commitData/applyServerShopping só tocam em refs e setters estáveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId],
  );

  useEffect(() => {
    const t = setTimeout(() => void load({ fromCache: true }), 0);
    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  function selectPlace(placeId: string) {
    setSelectedPlaceId(placeId);
    writeLastPlaceId(userId, placeId);
  }

  const activePlace = useMemo(() => {
    if (!data || data.places.length === 0) return null;
    return data.places.find((p) => p.id === selectedPlaceId) ?? data.places[0];
  }, [data, selectedPlaceId]);

  const { unchecked, checked } = useMemo(
    () => (activePlace ? splitPlaceItems(activePlace.items) : { unchecked: [], checked: [] }),
    [activePlace],
  );

  const suggestions = useMemo(
    () => matchCheckedSuggestions(checked, draftName, 5),
    [checked, draftName],
  );

  const exactMatch = useMemo(
    () => (activePlace ? findDuplicateItem(activePlace.items, draftName) : null),
    [activePlace, draftName],
  );

  async function toggleItem(item: ShoppingItemDTO) {
    if (item.id.startsWith("tmp-") || !dataRef.current) return;

    const nextChecked = !item.checked;
    const nowIso = new Date().toISOString();
    const nextAddedAt = nextChecked ? item.addedAt : nowIso;
    const nextCheckedAt = nextChecked ? nowIso : null;
    const seq = ++seqRef.current;

    pendingTogglesRef.current.set(item.id, {
      seq,
      checked: nextChecked,
      addedAt: nextAddedAt,
      checkedAt: nextCheckedAt,
    });

    const optimistic: ShoppingPayload = {
      places: dataRef.current.places.map((place) => {
        if (place.id !== item.placeId) return place;
        const patched = place.items.map((it) =>
          it.id === item.id
            ? { ...it, checked: nextChecked, addedAt: nextAddedAt, checkedAt: nextCheckedAt }
            : it,
        );
        const split = splitPlaceItems(patched);
        return { ...place, items: [...split.unchecked, ...split.checked] };
      }),
    };
    commitData(optimistic);

    try {
      const res = await fetch(`/api/shopping/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: nextChecked }),
      });
      const json = (await res.json().catch(() => null)) as {
        shopping?: ShoppingPayload;
        error?: string;
      } | null;
      if (!res.ok || !json?.shopping) {
        throw new Error(json?.error ?? "Não foi possível salvar.");
      }
      if (pendingTogglesRef.current.get(item.id)?.seq === seq) {
        pendingTogglesRef.current.delete(item.id);
        applyServerShopping(json.shopping);
      }
    } catch (err) {
      if (pendingTogglesRef.current.get(item.id)?.seq === seq) {
        pendingTogglesRef.current.delete(item.id);
        const cur = dataRef.current;
        if (cur) {
          const reverted: ShoppingPayload = {
            places: cur.places.map((place) => {
              if (place.id !== item.placeId) return place;
              const patched = place.items.map((it) => (it.id === item.id ? item : it));
              const split = splitPlaceItems(patched);
              return { ...place, items: [...split.unchecked, ...split.checked] };
            }),
          };
          commitData(reverted);
        }
        showToast(err instanceof Error ? err.message : "Não foi possível salvar.");
      }
    }
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activePlace || !dataRef.current) return;

    const cleaned = draftName.replace(/\s+/g, " ").trim();
    if (!cleaned) return;

    if (exactMatch) {
      setDraftName("");
      if (exactMatch.checked) {
        await toggleItem(exactMatch);
        showToast(`"${exactMatch.name}" voltou para A comprar`);
      } else {
        showToast(`"${exactMatch.name}" já está na lista`);
      }
      return;
    }

    const valid = validateItemName(cleaned);
    if (!valid.ok) {
      showToast(valid.message);
      return;
    }

    const tmpId = `tmp-${++seqRef.current}`;
    const tempItem: ShoppingItemDTO = {
      id: tmpId,
      placeId: activePlace.id,
      name: valid.data,
      quantity: null,
      checked: false,
      addedAt: new Date().toISOString(),
      checkedAt: null,
    };

    pendingTempsRef.current.set(tmpId, tempItem);
    setDraftName("");

    commitData({
      places: dataRef.current.places.map((place) => {
        if (place.id !== activePlace.id) return place;
        const split = splitPlaceItems([...place.items, tempItem]);
        return { ...place, items: [...split.unchecked, ...split.checked] };
      }),
    });

    try {
      const res = await fetch("/api/shopping/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: activePlace.id, name: valid.data }),
      });
      const json = (await res.json().catch(() => null)) as {
        shopping?: ShoppingPayload;
        reactivated?: boolean;
        alreadyPending?: boolean;
        item?: ShoppingItemDTO;
        error?: string;
      } | null;
      if (!res.ok || !json?.shopping) {
        throw new Error(json?.error ?? "Não foi possível adicionar o item.");
      }
      pendingTempsRef.current.delete(tmpId);
      applyServerShopping(json.shopping);
      if (json.reactivated && json.item) {
        showToast(`"${json.item.name}" voltou para A comprar`);
      } else if (json.alreadyPending && json.item) {
        showToast(`"${json.item.name}" já está na lista`);
      }
    } catch (err) {
      pendingTempsRef.current.delete(tmpId);
      if (dataRef.current) {
        commitData({
          places: dataRef.current.places.map((place) =>
            place.id === activePlace.id
              ? { ...place, items: place.items.filter((i) => i.id !== tmpId) }
              : place,
          ),
        });
      }
      showToast(err instanceof Error ? err.message : "Não foi possível adicionar o item.");
    }
  }

  async function handleSuggestionClick(item: ShoppingItemDTO) {
    setDraftName("");
    await toggleItem(item);
    showToast(`"${item.name}" voltou para A comprar`);
  }

  async function handleUpdateItem(
    itemId: string,
    patch: { name: string; quantity: string | null; placeId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/shopping/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as {
        shopping?: ShoppingPayload;
        error?: string;
      } | null;
      if (!res.ok || !json?.shopping) {
        return { ok: false, error: json?.error ?? "Não foi possível salvar." };
      }
      applyServerShopping(json.shopping);
      return { ok: true };
    } catch {
      return { ok: false, error: "Erro de conexão." };
    }
  }

  async function handleDeleteItem(itemId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/shopping/items/${itemId}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as {
        shopping?: ShoppingPayload;
        error?: string;
      } | null;
      if (!res.ok || !json?.shopping) {
        return { ok: false, error: json?.error ?? "Não foi possível excluir." };
      }
      applyServerShopping(json.shopping);
      return { ok: true };
    } catch {
      return { ok: false, error: "Erro de conexão." };
    }
  }

  async function handleSeedDefaults() {
    if (busyAction) return;
    setBusyAction(true);
    try {
      const res = await fetch("/api/shopping/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedDefaults: true }),
      });
      const json = (await res.json().catch(() => null)) as {
        shopping?: ShoppingPayload;
        error?: string;
      } | null;
      if (!res.ok || !json?.shopping) {
        throw new Error(json?.error ?? "Não foi possível criar os locais.");
      }
      applyServerShopping(json.shopping);
      const firstId = json.shopping.places[0]?.id;
      if (firstId) selectPlace(firstId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Não foi possível criar os locais.");
    } finally {
      setBusyAction(false);
    }
  }

  async function handleCheckAll() {
    if (!activePlace || unchecked.length < 2 || busyAction || !dataRef.current) return;
    if (
      !window.confirm(
        `Marcar todos os ${unchecked.length} itens de ${activePlace.name} como comprados?`,
      )
    ) {
      return;
    }

    const prev = dataRef.current;
    const nowIso = new Date().toISOString();
    commitData({
      places: prev.places.map((place) => {
        if (place.id !== activePlace.id) return place;
        const patched = place.items.map((it) =>
          it.checked ? it : { ...it, checked: true, checkedAt: nowIso },
        );
        const split = splitPlaceItems(patched);
        return { ...place, items: [...split.unchecked, ...split.checked] };
      }),
    });

    setBusyAction(true);
    try {
      const res = await fetch(`/api/shopping/places/${activePlace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkAll: true }),
      });
      const json = (await res.json().catch(() => null)) as {
        shopping?: ShoppingPayload;
        error?: string;
      } | null;
      if (!res.ok || !json?.shopping) {
        throw new Error(json?.error ?? "Não foi possível marcar todos.");
      }
      applyServerShopping(json.shopping);
    } catch (err) {
      commitData(prev);
      showToast(err instanceof Error ? err.message : "Não foi possível marcar todos.");
    } finally {
      setBusyAction(false);
    }
  }

  if (!data) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-zinc-800">
          <p className="text-4xl">⚠️</p>
          <div>
            <p className="font-medium">Não foi possível carregar as compras</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Verifique sua conexão e tente de novo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-11 items-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            Tentar de novo
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando lista de compras">
        <div className="mb-3 flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-32 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-4 w-44 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
          </div>
          <div className="h-10 w-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-700" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-9 w-24 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-2xl bg-white shadow-sm dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  const totalPending = countTotalPending(data);
  const subtitle = activePlace
    ? unchecked.length > 0
      ? `${unchecked.length} para comprar em ${activePlace.name}${totalPending > unchecked.length ? ` · ${totalPending} no total` : ""}`
      : activePlace.items.length > 0
        ? `Tudo comprado em ${activePlace.name}! 🎉`
        : `${activePlace.name} vazio`
    : "Organize suas compras por local";

  return (
    <>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Compras</h1>
          <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setPlacesOpen(true)}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          Locais
        </button>
      </header>

      {data.places.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-zinc-800">
          <p className="text-4xl">🛒</p>
          <div>
            <p className="font-medium">Sua lista de compras</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Separe por locais como Supermercado ou Feira. Quando algo acabar em casa, basta desmarcar para voltar para a lista de compras.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void handleSeedDefaults()}
              disabled={busyAction}
              className="flex h-11 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {busyAction ? "Criando…" : "Começar com Supermercado e Feira"}
            </button>
            <button
              type="button"
              onClick={() => setPlacesOpen(true)}
              disabled={busyAction}
              className="flex h-11 items-center justify-center rounded-xl border border-zinc-300 px-4 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-700"
            >
              Criar local personalizado
            </button>
          </div>
        </div>
      ) : (
        activePlace && (
          <>
            <div
              role="tablist"
              aria-label="Locais de compra"
              className="mb-4 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {data.places.map((place) => {
                const selected = place.id === activePlace.id;
                const pending = countPending(place);
                return (
                  <button
                    key={place.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => selectPlace(place.id)}
                    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition active:scale-[0.98] ${
                      selected
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-white text-zinc-600 shadow-sm hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-100"
                    }`}
                  >
                    <span>{place.name}</span>
                    {pending > 0 && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none ${
                          selected
                            ? "bg-white/20 text-white"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {pending}
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setPlacesOpen(true)}
                aria-label="Configurar locais"
                title="Configurar locais"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-500 shadow-sm transition hover:text-zinc-900 active:scale-[0.98] dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="mb-5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder={`Adicionar item em ${activePlace.name}…`}
                  maxLength={ITEM_NAME_MAX}
                  aria-label={`Adicionar item em ${activePlace.name}`}
                  className="h-12 min-w-0 flex-1 rounded-2xl border border-zinc-200 bg-white px-4 text-sm shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500"
                />
                <button
                  type="submit"
                  disabled={!draftName.trim()}
                  aria-label="Adicionar item"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm transition active:scale-[0.97] disabled:opacity-40"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-5 w-5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>

              {exactMatch && !exactMatch.checked && (
                <p className="mt-2 px-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  Já está em A comprar ({exactMatch.name})
                </p>
              )}

              {suggestions.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="px-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    Desmarcar dos marcados:
                  </span>
                  {suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void handleSuggestionClick(item)}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 active:scale-[0.98] dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
                    >
                      <span aria-hidden>+</span>
                      <span>{item.name}</span>
                      {item.quantity && (
                        <span className="font-normal opacity-75">({item.quantity})</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </form>

            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  A comprar ({unchecked.length})
                </h2>
                {unchecked.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => void handleCheckAll()}
                    disabled={busyAction}
                    className="text-xs font-semibold text-indigo-600 transition hover:underline disabled:opacity-50 dark:text-indigo-400"
                  >
                    Marcar tudo
                  </button>
                )}
              </div>

              {unchecked.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-300 p-5 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  {checked.length > 0
                    ? `Tudo comprado em ${activePlace.name} 🎉 — desmarque itens abaixo quando acabar em casa.`
                    : `Nenhum item em ${activePlace.name} ainda. Adicione acima o que você costuma comprar aqui.`}
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {unchecked.map((item) => (
                    <ShoppingItemRow
                      key={item.id}
                      item={item}
                      places={data.places}
                      onToggle={toggleItem}
                      onUpdate={handleUpdateItem}
                      onDelete={handleDeleteItem}
                    />
                  ))}
                </ul>
              )}
            </section>

            {checked.length > 0 && (
              <section className="mt-6">
                <button
                  type="button"
                  onClick={() => setCheckedOpen((o) => !o)}
                  aria-expanded={checkedOpen}
                  className="mb-2 flex w-full items-center justify-between px-1 text-left"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Marcados ({checked.length})
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    className={`h-4 w-4 text-zinc-400 transition ${checkedOpen ? "rotate-180" : ""}`}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {checkedOpen && (
                  <ul className="flex flex-col gap-2">
                    {checked.map((item) => (
                      <ShoppingItemRow
                        key={item.id}
                        item={item}
                        places={data.places}
                        onToggle={toggleItem}
                        onUpdate={handleUpdateItem}
                        onDelete={handleDeleteItem}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )
      )}

      {placesOpen && (
        <ShoppingPlacesModal
          places={data.places}
          onClose={() => setPlacesOpen(false)}
          onChanged={(shopping, opts) => {
            applyServerShopping(shopping);
            if (opts?.selectPlaceId) {
              selectPlace(opts.selectPlaceId);
            } else if (
              selectedPlaceId &&
              !shopping.places.some((p) => p.id === selectedPlaceId) &&
              shopping.places[0]
            ) {
              selectPlace(shopping.places[0].id);
            }
          }}
        />
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[90vw] rounded-full bg-zinc-900 px-4 py-2 text-center text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </div>
      )}
    </>
  );
}
