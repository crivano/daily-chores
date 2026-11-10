import { describe, expect, it } from "vitest";
import {
  autoCompleteState,
  exerciseSummary,
  formatSeconds,
  isTaskKind,
  validateExercises,
  validateValuesPatch,
  valuesDiffer,
  workoutCompletionAction,
  type ExerciseValues,
} from "./workout";

const base: ExerciseValues = { sets: 3, reps: 10, durationSec: null, load: 20, loadUnit: "kg" };

describe("workout — tipos", () => {
  it("reconhece SIMPLE e WORKOUT", () => {
    expect(isTaskKind("SIMPLE")).toBe(true);
    expect(isTaskKind("WORKOUT")).toBe(true);
    expect(isTaskKind("OUTRO")).toBe(false);
    expect(isTaskKind(undefined)).toBe(false);
  });
});

describe("validateExercises", () => {
  it("normaliza campos opcionais, nomes e ordem do array", () => {
    const r = validateExercises([
      { name: "  Supino  ", sets: 3, reps: 10, load: 22.499999, restSec: 60, notes: " pegada fechada " },
      { id: "ex1", name: "Prancha", durationSec: 45, sets: "", load: null },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0]).toEqual({
      id: null,
      name: "Supino",
      sets: 3,
      reps: 10,
      durationSec: null,
      load: 22.5,
      loadUnit: "kg",
      restSec: 60,
      notes: "pegada fechada",
    });
    expect(r.data[1]).toMatchObject({ id: "ex1", name: "Prancha", sets: null, durationSec: 45, load: null });
  });

  it("exige ao menos um exercício e nome", () => {
    expect(validateExercises([]).ok).toBe(false);
    expect(validateExercises([{ name: "  " }]).ok).toBe(false);
    expect(validateExercises("x").ok).toBe(false);
  });

  it("rejeita valores fora dos limites e unidade inválida", () => {
    expect(validateExercises([{ name: "A", sets: 0 }]).ok).toBe(false);
    expect(validateExercises([{ name: "A", reps: 2.5 }]).ok).toBe(false);
    expect(validateExercises([{ name: "A", load: -1 }]).ok).toBe(false);
    expect(validateExercises([{ name: "A", loadUnit: "t" }]).ok).toBe(false);
    expect(validateExercises([{ name: "A", restSec: 0 }]).ok).toBe(true);
  });

  it("rejeita id repetido", () => {
    expect(validateExercises([{ id: "a", name: "A" }, { id: "a", name: "B" }]).ok).toBe(false);
  });
});

describe("validateValuesPatch / valuesDiffer", () => {
  it("só inclui as chaves enviadas; null limpa", () => {
    const r = validateValuesPatch({ load: 25, reps: null }, "Supino");
    expect(r).toEqual({ ok: true, data: { load: 25, reps: null } });
  });

  it("valida os valores enviados", () => {
    expect(validateValuesPatch({ sets: 0 }, "X").ok).toBe(false);
  });

  it("detecta mudança em relação ao plano", () => {
    expect(valuesDiffer(base, { load: 20 })).toBe(false);
    expect(valuesDiffer(base, { load: 22.5 })).toBe(true);
    expect(valuesDiffer(base, {})).toBe(false);
  });
});

describe("formatação", () => {
  it("formatSeconds", () => {
    expect(formatSeconds(45)).toBe("45s");
    expect(formatSeconds(60)).toBe("1min");
    expect(formatSeconds(90)).toBe("1min30s");
  });

  it("exerciseSummary cobre reps, tempo, só carga e vírgula decimal", () => {
    expect(exerciseSummary(base)).toBe("3×10 · 20 kg");
    expect(exerciseSummary({ ...base, reps: null, durationSec: 45, load: null })).toBe("3×45s");
    expect(exerciseSummary({ ...base, sets: null, load: 22.5, loadUnit: "lb" })).toBe("10 reps · 22,5 lb");
    expect(exerciseSummary({ sets: null, reps: null, durationSec: null, load: null, loadUnit: "kg" })).toBe("");
  });
});

describe("autoCompleteState", () => {
  it("DONE quando permitido (inclusive sem restrição)", () => {
    expect(autoCompleteState(null)).toBe("DONE");
    expect(autoCompleteState(["DONE", "BOMB"])).toBe("DONE");
  });
  it("primeiro conclusivo permitido; null se nenhum", () => {
    expect(autoCompleteState(["CANCELLED", "HAPPY", "SAD"])).toBe("HAPPY");
    expect(autoCompleteState(["CANCELLED"])).toBeNull();
  });
});

describe("workoutCompletionAction", () => {
  const at = new Date("2026-11-10T10:30:00Z");

  it("marcar o último exercício conclui com a hora do último", () => {
    expect(
      workoutCompletionAction({ wasAllDone: false, isAllDone: true, current: null, autoState: "DONE", lastDoneAt: at }),
    ).toEqual({ kind: "upsert", status: "DONE", completedAt: at });
  });

  it("parcial não conclui", () => {
    expect(
      workoutCompletionAction({ wasAllDone: false, isAllDone: false, current: null, autoState: "DONE", lastDoneAt: at }),
    ).toEqual({ kind: "none" });
  });

  it("desmarcar de uma série completa desfaz o automático", () => {
    expect(
      workoutCompletionAction({ wasAllDone: true, isAllDone: false, current: "DONE", autoState: "DONE", lastDoneAt: at }),
    ).toEqual({ kind: "delete" });
  });

  it("estado escolhido à mão nunca é tocado", () => {
    for (const current of ["HAPPY", "BOMB", "CANCELLED"] as const) {
      expect(
        workoutCompletionAction({ wasAllDone: false, isAllDone: true, current, autoState: "DONE", lastDoneAt: at }),
      ).toEqual({ kind: "none" });
      expect(
        workoutCompletionAction({ wasAllDone: true, isAllDone: false, current, autoState: "DONE", lastDoneAt: at }),
      ).toEqual({ kind: "none" });
    }
  });

  it("DONE manual com série incompleta não é desfeito por marcar um exercício", () => {
    expect(
      workoutCompletionAction({ wasAllDone: false, isAllDone: false, current: "DONE", autoState: "DONE", lastDoneAt: at }),
    ).toEqual({ kind: "none" });
  });

  it("sem estado automático possível, não faz nada", () => {
    expect(
      workoutCompletionAction({ wasAllDone: false, isAllDone: true, current: null, autoState: null, lastDoneAt: at }),
    ).toEqual({ kind: "none" });
  });
});
