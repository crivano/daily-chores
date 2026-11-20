/**
 * Cardápio estruturado de refeições (Task.kind = "MEAL") — funções PURAS,
 * isomórficas.
 *
 * Modela planos alimentares prescritos por nutricionista:
 * - 1 ou mais variações/opções inteiras da mesma refeição (ex.: Jantar
 *   "Comida" vs. "Opção lanche"); quando há só 1 opção, o nome é opcional;
 * - cada opção tem itens (alimento principal + quantidade opcional) e uma
 *   lista opcional de substituições equivalentes (expansíveis na UI para
 *   manter a tela limpa no celular);
 * - observações por opção (ex.: ordem de consumo, suplementos, preparo) e
 *   observações gerais da refeição.
 */
export { TASK_KINDS, isTaskKind, type TaskKind } from "./taskKind";

export const MAX_MEAL_OPTIONS = 10;
export const MAX_MEAL_ITEMS = 30;
export const MAX_MEAL_SUBSTITUTIONS = 20;
export const MEAL_OPTION_NAME_MAX = 60;
export const MEAL_FOOD_MAX = 140;
export const MEAL_QUANTITY_MAX = 120;
export const MEAL_NOTES_MAX = 1500;

/** Substituição equivalente de um item (ex.: "Arroz branco cozido", "3 colheres (75g)"). */
export interface MealSubstitution {
  food: string;
  quantity: string | null;
}

/** Item do cardápio: alimento principal + quantidade + trocas equivalentes. */
export interface MealItem {
  food: string;
  quantity: string | null;
  substitutions: MealSubstitution[];
}

/** Variação/cardápio completo da refeição (ex.: "Comida" ou "Opção lanche"). */
export interface MealOption {
  name: string | null;
  items: MealItem[];
  notes: string | null;
}

/** Cardápio completo salvo em Task.mealPlan. */
export interface MealPlan {
  options: MealOption[];
  notes: string | null;
}

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

function cleanSingleLine(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function cleanMultiline(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.replace(/\r\n?/g, "\n").trim();
  return trimmed || null;
}

function validateOptionalText(
  v: unknown,
  max: number,
  label: string,
  multiline = false,
): Result<string | null> {
  if (v === undefined || v === null || v === "") return { ok: true, data: null };
  if (typeof v !== "string") return { ok: false, message: `${label} deve ser texto.` };
  const cleaned = multiline ? cleanMultiline(v) : cleanSingleLine(v);
  if (!cleaned) return { ok: true, data: null };
  if (cleaned.length > max) {
    return { ok: false, message: `${label} muito longo (máx. ${max} caracteres).` };
  }
  return { ok: true, data: cleaned };
}

function validateSubstitution(raw: unknown, who: string): Result<MealSubstitution> {
  if (typeof raw === "string") {
    const food = cleanSingleLine(raw);
    if (!food) return { ok: false, message: `${who}: informe o alimento da substituição.` };
    if (food.length > MEAL_FOOD_MAX) {
      return { ok: false, message: `${who}: texto muito longo (máx. ${MEAL_FOOD_MAX} caracteres).` };
    }
    return { ok: true, data: { food, quantity: null } };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: `${who}: formato inválido.` };
  }
  const obj = raw as Record<string, unknown>;
  const food = cleanSingleLine(obj.food);
  if (!food) return { ok: false, message: `${who}: informe o alimento da substituição.` };
  if (food.length > MEAL_FOOD_MAX) {
    return { ok: false, message: `${who}: alimento muito longo (máx. ${MEAL_FOOD_MAX} caracteres).` };
  }
  const qty = validateOptionalText(obj.quantity, MEAL_QUANTITY_MAX, `${who}: quantidade`);
  if (!qty.ok) return qty;
  return { ok: true, data: { food, quantity: qty.data } };
}

function validateItem(raw: unknown, who: string): Result<MealItem> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: `${who}: formato inválido.` };
  }
  const obj = raw as Record<string, unknown>;
  const food = cleanSingleLine(obj.food);
  if (!food) return { ok: false, message: `${who}: informe o alimento.` };
  if (food.length > MEAL_FOOD_MAX) {
    return { ok: false, message: `${who}: alimento muito longo (máx. ${MEAL_FOOD_MAX} caracteres).` };
  }
  const qty = validateOptionalText(obj.quantity, MEAL_QUANTITY_MAX, `${who}: quantidade`);
  if (!qty.ok) return qty;

  let substitutions: MealSubstitution[] = [];
  if (obj.substitutions !== undefined && obj.substitutions !== null) {
    if (!Array.isArray(obj.substitutions)) {
      return { ok: false, message: `${who}: substitutions deve ser um array.` };
    }
    if (obj.substitutions.length > MAX_MEAL_SUBSTITUTIONS) {
      return { ok: false, message: `${who}: máximo de ${MAX_MEAL_SUBSTITUTIONS} substituições por item.` };
    }
    substitutions = [];
    for (let i = 0; i < obj.substitutions.length; i += 1) {
      const sub = validateSubstitution(obj.substitutions[i], `${who}, substituição ${i + 1}`);
      if (!sub.ok) return sub;
      substitutions.push(sub.data);
    }
  }

  return { ok: true, data: { food, quantity: qty.data, substitutions } };
}

/**
 * Valida e normaliza um cardápio completo vindo da UI, API ou MCP.
 * Exige ≥ 1 opção com ≥ 1 item; se houver ≥ 2 opções, cada uma precisa ter nome.
 */
export function validateMealPlan(input: unknown): Result<MealPlan> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "mealPlan deve ser um objeto com options." };
  }
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.options)) {
    return { ok: false, message: "mealPlan.options deve ser um array." };
  }
  if (obj.options.length === 0) {
    return { ok: false, message: "Cadastre pelo menos uma opção de cardápio." };
  }
  if (obj.options.length > MAX_MEAL_OPTIONS) {
    return { ok: false, message: `Máximo de ${MAX_MEAL_OPTIONS} variações por refeição.` };
  }

  const multipleOptions = obj.options.length > 1;
  const options: MealOption[] = [];

  for (let i = 0; i < obj.options.length; i += 1) {
    const rawOpt = obj.options[i];
    const optLabel = multipleOptions ? `Variação ${i + 1}` : "Cardápio";
    if (!rawOpt || typeof rawOpt !== "object" || Array.isArray(rawOpt)) {
      return { ok: false, message: `${optLabel}: formato inválido.` };
    }
    const optObj = rawOpt as Record<string, unknown>;
    const nameRes = validateOptionalText(optObj.name, MEAL_OPTION_NAME_MAX, `${optLabel}: nome`);
    if (!nameRes.ok) return nameRes;
    if (multipleOptions && !nameRes.data) {
      return { ok: false, message: `${optLabel}: informe um nome (ex.: Comida, Opção lanche).` };
    }

    if (!Array.isArray(optObj.items) || optObj.items.length === 0) {
      return { ok: false, message: `${optLabel}: cadastre pelo menos um item.` };
    }
    if (optObj.items.length > MAX_MEAL_ITEMS) {
      return { ok: false, message: `${optLabel}: máximo de ${MAX_MEAL_ITEMS} itens.` };
    }

    const items: MealItem[] = [];
    for (let j = 0; j < optObj.items.length; j += 1) {
      const itemPrefix = multipleOptions ? `${nameRes.data ?? optLabel}, item ${j + 1}` : `Item ${j + 1}`;
      const itemRes = validateItem(optObj.items[j], itemPrefix);
      if (!itemRes.ok) return itemRes;
      items.push(itemRes.data);
    }

    const notesRes = validateOptionalText(optObj.notes, MEAL_NOTES_MAX, `${optLabel}: observações`, true);
    if (!notesRes.ok) return notesRes;

    options.push({ name: nameRes.data, items, notes: notesRes.data });
  }

  const planNotes = validateOptionalText(obj.notes, MEAL_NOTES_MAX, "Observações da refeição", true);
  if (!planNotes.ok) return planNotes;

  return { ok: true, data: { options, notes: planNotes.data } };
}

/** Leitura defensiva do JSON vindo do banco ou cache — nunca lança exceção. */
export function parseMealPlan(raw: unknown): MealPlan | null {
  if (raw == null) return null;
  const r = validateMealPlan(raw);
  return r.ok ? r.data : null;
}

/** Conta quantos itens de uma opção possuem substituições cadastradas. */
export function countItemsWithSubstitutions(option: MealOption): number {
  return option.items.filter((i) => i.substitutions.length > 0).length;
}

/**
 * Resumo curto para subtítulos (TaskRow / TasksManager):
 * - 1 opção → "4 itens" (ou "1 item");
 * - 2 opções nomeadas → "2 opções · Comida / Opção lanche";
 * - 3+ opções → "3 opções".
 */
export function mealSummary(plan: MealPlan): string {
  if (plan.options.length > 1) {
    if (plan.options.length === 2 && plan.options[0].name && plan.options[1].name) {
      return `2 opções · ${plan.options[0].name} / ${plan.options[1].name}`;
    }
    return `${plan.options.length} opções`;
  }
  const n = plan.options[0]?.items.length ?? 0;
  return `${n} ${n === 1 ? "item" : "itens"}`;
}
