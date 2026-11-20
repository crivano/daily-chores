import { describe, expect, it } from "vitest";
import {
  ITEM_NAME_MAX,
  ITEM_QUANTITY_MAX,
  PLACE_NAME_MAX,
  countPending,
  countTotalPending,
  findDuplicateItem,
  matchCheckedSuggestions,
  normalizeKey,
  splitPlaceItems,
  validateItemName,
  validateItemQuantity,
  validatePlaceName,
  type ShoppingItemDTO,
  type ShoppingPlaceDTO,
} from "./shopping";

function makeItem(overrides: Partial<ShoppingItemDTO> & { id: string; name: string }): ShoppingItemDTO {
  return {
    placeId: "place-1",
    quantity: null,
    checked: false,
    addedAt: "2026-11-20T12:00:00.000Z",
    checkedAt: null,
    ...overrides,
  };
}

describe("normalizeKey", () => {
  it("normaliza acentos, caixa e espaços extras", () => {
    expect(normalizeKey("  Açúcar   Mascavo  ")).toBe("acucar mascavo");
    expect(normalizeKey("MAÇÃ Fuji")).toBe("maca fuji");
    expect(normalizeKey("Pão Francês")).toBe("pao frances");
  });
});

describe("validações de local e item", () => {
  it("valida nome de local", () => {
    expect(validatePlaceName("  Supermercado   Central ")).toEqual({
      ok: true,
      data: "Supermercado Central",
    });
    expect(validatePlaceName("   ").ok).toBe(false);
    expect(validatePlaceName(null).ok).toBe(false);
    expect(validatePlaceName("a".repeat(PLACE_NAME_MAX + 1)).ok).toBe(false);
  });

  it("valida nome de item", () => {
    expect(validateItemName("  Leite   Integral ")).toEqual({
      ok: true,
      data: "Leite Integral",
    });
    expect(validateItemName("").ok).toBe(false);
    expect(validateItemName(123).ok).toBe(false);
    expect(validateItemName("a".repeat(ITEM_NAME_MAX + 1)).ok).toBe(false);
  });

  it("valida quantidade opcional de item", () => {
    expect(validateItemQuantity(undefined)).toEqual({ ok: true, data: null });
    expect(validateItemQuantity(null)).toEqual({ ok: true, data: null });
    expect(validateItemQuantity("   ")).toEqual({ ok: true, data: null });
    expect(validateItemQuantity("  2   caixas ")).toEqual({ ok: true, data: "2 caixas" });
    expect(validateItemQuantity(42).ok).toBe(false);
    expect(validateItemQuantity("a".repeat(ITEM_QUANTITY_MAX + 1)).ok).toBe(false);
  });
});

describe("splitPlaceItems", () => {
  it("ordena não marcados por addedAt desc (desempate pt-BR) e marcados alfabeticamente", () => {
    const items: ShoppingItemDTO[] = [
      makeItem({ id: "1", name: "Arroz", checked: false, addedAt: "2026-11-20T10:00:00.000Z" }),
      makeItem({ id: "2", name: "Café", checked: false, addedAt: "2026-11-20T11:00:00.000Z" }),
      makeItem({ id: "3", name: "Banana", checked: false, addedAt: "2026-11-20T11:00:00.000Z" }),
      makeItem({ id: "4", name: "Óleo", checked: true }),
      makeItem({ id: "5", name: "Açúcar", checked: true }),
      makeItem({ id: "6", name: "Azeite", checked: true }),
    ];

    const { unchecked, checked } = splitPlaceItems(items);
    expect(unchecked.map((i) => i.name)).toEqual(["Banana", "Café", "Arroz"]);
    expect(checked.map((i) => i.name)).toEqual(["Açúcar", "Azeite", "Óleo"]);
  });
});

describe("findDuplicateItem", () => {
  const items = [
    makeItem({ id: "a", name: "Pão Francês", checked: true }),
    makeItem({ id: "b", name: "Leite", checked: false }),
  ];

  it("encontra duplicata ignorando caixa e acentos", () => {
    expect(findDuplicateItem(items, "pao frances")?.id).toBe("a");
    expect(findDuplicateItem(items, "  LEITE ")?.id).toBe("b");
    expect(findDuplicateItem(items, "Manteiga")).toBeNull();
  });

  it("respeita excludeId", () => {
    expect(findDuplicateItem(items, "pao frances", "a")).toBeNull();
    expect(findDuplicateItem(items, "leite", "a")?.id).toBe("b");
  });
});

describe("matchCheckedSuggestions", () => {
  const checked = [
    makeItem({ id: "3", name: "Suco de Maçã", checked: true }),
    makeItem({ id: "1", name: "Maçã Fuji", checked: true }),
    makeItem({ id: "2", name: "Macarrão Penne", checked: true }),
    makeItem({ id: "4", name: "Torta de Maçã", checked: true }),
    makeItem({ id: "5", name: "Mamão", checked: true }),
    makeItem({ id: "6", name: "Manteiga", checked: true }),
  ];

  it("prioriza prefixo antes de substring e respeita limite e acentos", () => {
    expect(matchCheckedSuggestions(checked, "maca").map((i) => i.name)).toEqual([
      "Maçã Fuji",
      "Macarrão Penne",
      "Suco de Maçã",
      "Torta de Maçã",
    ]);
    expect(matchCheckedSuggestions(checked, "ma", 4).map((i) => i.name)).toEqual([
      "Maçã Fuji",
      "Macarrão Penne",
      "Mamão",
      "Manteiga",
    ]);
    expect(matchCheckedSuggestions(checked, "   ")).toEqual([]);
    expect(matchCheckedSuggestions(checked, "ma", 0)).toEqual([]);
  });
});

describe("contadores de pendentes", () => {
  it("conta itens não marcados por local e no total", () => {
    const places: ShoppingPlaceDTO[] = [
      {
        id: "p1",
        name: "Supermercado",
        position: 0,
        items: [
          makeItem({ id: "1", name: "Arroz", checked: false }),
          makeItem({ id: "2", name: "Feijão", checked: true }),
          makeItem({ id: "3", name: "Leite", checked: false }),
        ],
      },
      {
        id: "p2",
        name: "Feira",
        position: 1,
        items: [
          makeItem({ id: "4", placeId: "p2", name: "Tomate", checked: true }),
          makeItem({ id: "5", placeId: "p2", name: "Alface", checked: false }),
        ],
      },
    ];
    expect(countPending(places[0])).toBe(2);
    expect(countPending(places[1])).toBe(1);
    expect(countTotalPending({ places })).toBe(3);
  });
});
