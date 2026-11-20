/**
 * Resolução de cardápio (Task.kind = "MEAL") em POST/PATCH de tarefas.
 * As regras puras de validação vivem em lib/domain/meal.ts.
 */
import { parseMealPlan, validateMealPlan, type MealPlan } from "./domain/meal";
import type { TaskKind } from "./domain/taskKind";

export type MealPlanResolution =
  | { ok: true; data: MealPlan | undefined } // undefined = não alterar o mealPlan salvo
  | { ok: false; status: number; message: string };

/**
 * Decide o que fazer com `mealPlan` do corpo de POST/PATCH:
 * - tarefa SIMPLE/WORKOUT: ignora (cardápio antigo, se houver, fica preservado);
 * - MEAL com payload: valida (≥ 1 opção, ≥ 1 item);
 * - MEAL sem payload: criação exige; patch exige que já exista um cardápio válido salvo.
 */
export function resolveMealPlanInput(
  kind: TaskKind,
  raw: unknown,
  existingMealPlan?: unknown,
): MealPlanResolution {
  if (kind !== "MEAL") return { ok: true, data: undefined };
  if (raw === undefined) {
    if (parseMealPlan(existingMealPlan)) return { ok: true, data: undefined };
    return { ok: false, status: 400, message: "Cadastre pelo menos um item no cardápio da refeição." };
  }
  const r = validateMealPlan(raw);
  return r.ok ? { ok: true, data: r.data } : { ok: false, status: 400, message: r.message };
}
