import { describe, expect, it } from "vitest";
import {
  MAX_MEAL_ITEMS,
  MAX_MEAL_OPTIONS,
  MAX_MEAL_SUBSTITUTIONS,
  MEAL_FOOD_MAX,
  MEAL_NOTES_MAX,
  countItemsWithSubstitutions,
  mealSummary,
  parseMealPlan,
  validateMealPlan,
} from "./meal";
import { resolveMealPlanInput } from "../meals";

describe("validateMealPlan", () => {
  it("aceita 1 opção sem nome, itens com/sem quantidade, substituições e notas multilinha", () => {
    const r = validateMealPlan({
      options: [
        {
          items: [
            {
              food: "  Ovo de galinha frito/mexido  ",
              quantity: " 2 unidades médias (100g) ",
              substitutions: ["Ou escolha 1 porção do grupo 4 da lista de substituição."],
            },
            {
              food: "Pão de forma integral",
              quantity: "1 fatia (25g)",
              substitutions: [
                { food: "Pão tipo folha/rap", quantity: "1 unidade média (40g)" },
                { food: "Pão de forma de milho", quantity: "" },
              ],
            },
            { food: "Água" },
          ],
          notes: "  Linha 1\r\nLinha 2  ",
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      notes: null,
      options: [
        {
          name: null,
          notes: "Linha 1\nLinha 2",
          items: [
            {
              food: "Ovo de galinha frito/mexido",
              quantity: "2 unidades médias (100g)",
              substitutions: [
                { food: "Ou escolha 1 porção do grupo 4 da lista de substituição.", quantity: null },
              ],
            },
            {
              food: "Pão de forma integral",
              quantity: "1 fatia (25g)",
              substitutions: [
                { food: "Pão tipo folha/rap", quantity: "1 unidade média (40g)" },
                { food: "Pão de forma de milho", quantity: null },
              ],
            },
            { food: "Água", quantity: null, substitutions: [] },
          ],
        },
      ],
    });
  });

  it("aceita múltiplas variações nomeadas (ex.: Jantar Comida e Opção lanche)", () => {
    const r = validateMealPlan({
      options: [
        {
          name: "Comida",
          items: [{ food: "Patinho moído refogado", quantity: "4 colheres (100g)" }],
          notes: "Procure fazer o jantar COMIDA pelo menos 3x na semana",
        },
        {
          name: "Opção lanche",
          items: [{ food: "Rap10 fibras", quantity: "1 unidade (40g)" }],
          notes: "Legumes à vontade",
        },
      ],
      notes: "Observação geral",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.options).toHaveLength(2);
    expect(r.data.notes).toBe("Observação geral");
    expect(mealSummary(r.data)).toBe("2 opções · Comida / Opção lanche");
  });

  it("exige nome nas variações quando há 2 ou mais opções", () => {
    const r = validateMealPlan({
      options: [
        { name: "Comida", items: [{ food: "Arroz" }] },
        { name: "  ", items: [{ food: "Rap10" }] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Variação 2.*nome/i);
  });

  it("rejeita estrutura inválida ou vazia", () => {
    expect(validateMealPlan(null).ok).toBe(false);
    expect(validateMealPlan([]).ok).toBe(false);
    expect(validateMealPlan({ options: [] }).ok).toBe(false);
    expect(validateMealPlan({ options: [{ items: [] }] }).ok).toBe(false);
    expect(validateMealPlan({ options: [{ items: [{ food: "   " }] }] }).ok).toBe(false);
    expect(
      validateMealPlan({ options: [{ items: [{ food: "Pão", substitutions: [{ food: "" }] }] }] }).ok,
    ).toBe(false);
  });

  it("respeita limites máximos de opções, itens, substituições e tamanhos de texto", () => {
    const manyOpts = Array.from({ length: MAX_MEAL_OPTIONS + 1 }, (_, i) => ({
      name: `Opção ${i + 1}`,
      items: [{ food: "Arroz" }],
    }));
    expect(validateMealPlan({ options: manyOpts }).ok).toBe(false);

    const manyItems = Array.from({ length: MAX_MEAL_ITEMS + 1 }, (_, i) => ({ food: `Item ${i}` }));
    expect(validateMealPlan({ options: [{ items: manyItems }] }).ok).toBe(false);

    const manySubs = Array.from({ length: MAX_MEAL_SUBSTITUTIONS + 1 }, (_, i) => ({ food: `Sub ${i}` }));
    expect(validateMealPlan({ options: [{ items: [{ food: "Pão", substitutions: manySubs }] }] }).ok).toBe(
      false,
    );

    expect(
      validateMealPlan({ options: [{ items: [{ food: "a".repeat(MEAL_FOOD_MAX + 1) }] }] }).ok,
    ).toBe(false);
    expect(
      validateMealPlan({ options: [{ items: [{ food: "Arroz" }], notes: "a".repeat(MEAL_NOTES_MAX + 1) }] })
        .ok,
    ).toBe(false);
  });
});

describe("parseMealPlan, mealSummary e countItemsWithSubstitutions", () => {
  it("parseMealPlan devolve null para dados ausentes ou corrompidos sem lançar erro", () => {
    expect(parseMealPlan(null)).toBeNull();
    expect(parseMealPlan(undefined)).toBeNull();
    expect(parseMealPlan("lixo")).toBeNull();
    expect(parseMealPlan({ options: [] })).toBeNull();
  });

  it("mealSummary formata singular, plural, 2 opções e 3+ opções", () => {
    const oneItem = parseMealPlan({ options: [{ items: [{ food: "Whey" }] }] })!;
    expect(mealSummary(oneItem)).toBe("1 item");

    const fourItems = parseMealPlan({
      options: [{ items: [{ food: "A" }, { food: "B" }, { food: "C" }, { food: "D" }] }],
    })!;
    expect(mealSummary(fourItems)).toBe("4 itens");

    const threeOpts = parseMealPlan({
      options: [
        { name: "A", items: [{ food: "X" }] },
        { name: "B", items: [{ food: "Y" }] },
        { name: "C", items: [{ food: "Z" }] },
      ],
    })!;
    expect(mealSummary(threeOpts)).toBe("3 opções");
  });

  it("countItemsWithSubstitutions conta só os itens que têm ao menos 1 substituição", () => {
    const plan = parseMealPlan({
      options: [
        {
          items: [
            { food: "Castanha", substitutions: [{ food: "Amêndoa" }] },
            { food: "Água", substitutions: [] },
            { food: "Fruta", substitutions: [{ food: "Pêssego" }, { food: "Morango" }] },
          ],
        },
      ],
    })!;
    expect(countItemsWithSubstitutions(plan.options[0])).toBe(2);
  });
});

describe("resolveMealPlanInput", () => {
  const valid = { options: [{ items: [{ food: "Whey", quantity: "30g" }] }] };

  it("ignora mealPlan quando a tarefa não é MEAL", () => {
    expect(resolveMealPlanInput("SIMPLE", undefined)).toEqual({ ok: true, data: undefined });
    expect(resolveMealPlanInput("WORKOUT", { lixo: true })).toEqual({ ok: true, data: undefined });
  });

  it("exige mealPlan na criação de MEAL e mantém o existente no patch sem mealPlan", () => {
    expect(resolveMealPlanInput("MEAL", undefined).ok).toBe(false);
    expect(resolveMealPlanInput("MEAL", undefined, valid)).toEqual({ ok: true, data: undefined });
    const res = resolveMealPlanInput("MEAL", valid);
    expect(res.ok).toBe(true);
  });
});
