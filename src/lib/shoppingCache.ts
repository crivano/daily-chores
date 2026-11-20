/**
 * Cache da lista de compras em localStorage — client-only.
 * Espelho de dayCache.ts para pintura instantânea ao abrir a aba Compras.
 */
import type { ShoppingPayload } from "./domain/shopping";

const PREFIX = "dc:shopping:v1";
const PLACE_PREFIX = "dc:shopping:place:v1";

export function readShoppingCache(userId: string): ShoppingPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}:${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShoppingPayload;
    return parsed && Array.isArray(parsed.places) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeShoppingCache(userId: string, payload: ShoppingPayload): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${PREFIX}:${userId}`, JSON.stringify(payload));
  } catch {
    // quota cheia/disabled — cache é best-effort.
  }
}

export function readLastPlaceId(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${PLACE_PREFIX}:${userId}`);
  } catch {
    return null;
  }
}

export function writeLastPlaceId(userId: string, placeId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${PLACE_PREFIX}:${userId}`, placeId);
  } catch {
    // best-effort.
  }
}
