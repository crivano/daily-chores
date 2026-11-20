/**
 * Domínio puro da lista de compras por locais — funções isomórficas (sem Prisma).
 *
 * Modela uma lista persistente por local configurável (Supermercado, Feira…):
 * - `checked = false` → "A comprar" (ordenado do mais recentemente adicionado/desmarcado ao mais antigo);
 * - `checked = true`  → "Marcados" (catálogo em ordem alfabética pt-BR para achar rápido e desmarcar quando acabar em casa).
 */

export const PLACE_NAME_MAX = 50;
export const ITEM_NAME_MAX = 100;
export const ITEM_QUANTITY_MAX = 60;
export const MAX_PLACES = 30;
export const MAX_ITEMS_PER_PLACE = 500;
export const DEFAULT_PLACES = ["Supermercado", "Feira"] as const;

export interface ShoppingItemDTO {
  id: string;
  placeId: string;
  name: string;
  quantity: string | null;
  checked: boolean;
  addedAt: string;
  checkedAt: string | null;
}

export interface ShoppingPlaceDTO {
  id: string;
  name: string;
  position: number;
  items: ShoppingItemDTO[];
}

export interface ShoppingPayload {
  places: ShoppingPlaceDTO[];
}

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Chave normalizada para comparar nomes sem acentos nem diferença de caixa. */
export function normalizeKey(text: string): string {
  return cleanText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function validatePlaceName(raw: unknown): Result<string> {
  if (typeof raw !== "string") {
    return { ok: false, message: "Informe o nome do local." };
  }
  const cleaned = cleanText(raw);
  if (!cleaned) {
    return { ok: false, message: "Informe o nome do local." };
  }
  if (cleaned.length > PLACE_NAME_MAX) {
    return { ok: false, message: `Nome do local muito longo (máx. ${PLACE_NAME_MAX} caracteres).` };
  }
  return { ok: true, data: cleaned };
}

export function validateItemName(raw: unknown): Result<string> {
  if (typeof raw !== "string") {
    return { ok: false, message: "Informe o nome do item." };
  }
  const cleaned = cleanText(raw);
  if (!cleaned) {
    return { ok: false, message: "Informe o nome do item." };
  }
  if (cleaned.length > ITEM_NAME_MAX) {
    return { ok: false, message: `Nome do item muito longo (máx. ${ITEM_NAME_MAX} caracteres).` };
  }
  return { ok: true, data: cleaned };
}

export function validateItemQuantity(raw: unknown): Result<string | null> {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, data: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, message: "Quantidade deve ser texto." };
  }
  const cleaned = cleanText(raw);
  if (!cleaned) {
    return { ok: true, data: null };
  }
  if (cleaned.length > ITEM_QUANTITY_MAX) {
    return { ok: false, message: `Quantidade muito longa (máx. ${ITEM_QUANTITY_MAX} caracteres).` };
  }
  return { ok: true, data: cleaned };
}

export function compareUnchecked(a: ShoppingItemDTO, b: ShoppingItemDTO): number {
  const ta = Date.parse(a.addedAt) || 0;
  const tb = Date.parse(b.addedAt) || 0;
  if (tb !== ta) return tb - ta;
  return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
}

export function compareChecked(a: ShoppingItemDTO, b: ShoppingItemDTO): number {
  return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
}

/** Separa os itens de um local entre não marcados ("A comprar") e marcados ("Marcados"), já ordenados. */
export function splitPlaceItems(items: ShoppingItemDTO[]): {
  unchecked: ShoppingItemDTO[];
  checked: ShoppingItemDTO[];
} {
  const unchecked: ShoppingItemDTO[] = [];
  const checked: ShoppingItemDTO[] = [];
  for (const item of items) {
    if (item.checked) checked.push(item);
    else unchecked.push(item);
  }
  unchecked.sort(compareUnchecked);
  checked.sort(compareChecked);
  return { unchecked, checked };
}

/** Procura um item com o mesmo nome normalizado (insensível a acentos/caixa). */
export function findDuplicateItem(
  items: ShoppingItemDTO[],
  name: string,
  excludeId?: string,
): ShoppingItemDTO | null {
  const key = normalizeKey(name);
  if (!key) return null;
  for (const item of items) {
    if (excludeId && item.id === excludeId) continue;
    if (normalizeKey(item.name) === key) return item;
  }
  return null;
}

/**
 * Sugestões dentre os itens já marcados enquanto o usuário digita:
 * prioriza prefixo (`startsWith`) sobre ocorrência no meio (`includes`).
 */
export function matchCheckedSuggestions(
  checked: ShoppingItemDTO[],
  query: string,
  limit = 5,
): ShoppingItemDTO[] {
  const key = normalizeKey(query);
  if (!key || limit <= 0) return [];
  const starts: ShoppingItemDTO[] = [];
  const includes: ShoppingItemDTO[] = [];
  for (const item of checked) {
    const itemKey = normalizeKey(item.name);
    if (itemKey.startsWith(key)) starts.push(item);
    else if (itemKey.includes(key)) includes.push(item);
  }
  return [...starts, ...includes].slice(0, limit);
}

export function countPending(place: ShoppingPlaceDTO): number {
  let count = 0;
  for (const item of place.items) {
    if (!item.checked) count += 1;
  }
  return count;
}

export function countTotalPending(payload: ShoppingPayload): number {
  let total = 0;
  for (const place of payload.places) {
    total += countPending(place);
  }
  return total;
}
