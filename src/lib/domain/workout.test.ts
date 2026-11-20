import { describe, expect, it } from "vitest";
import {
  autoCompleteState,
  describeDayValueAdjustment,
  describeExerciseAdded,
  describeExerciseDiff,
  describeExerciseRemoved,
  describeExerciseValuesDiff,
  describePlanEdit,
  exerciseOrderChanged,
  exerciseSummary,
  formatSeconds,
  isTaskKind,
  validateExercises,
  validateValuesPatch,
  valuesDiffer,
  workoutCompletionAction,
  type ExerciseSnapshot,
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

describe("histórico textual de alterações em exercícios", () => {
  const snap: ExerciseSnapshot = {
    name: "Supino",
    sets: 3,
    reps: 10,
    durationSec: null,
    load: 20,
    loadUnit: "kg",
    restSec: 60,
    notes: "pegada fechada",
  };

  it("sem mudança retorna lista vazia (inclusive mudar loadUnit com carga nula)", () => {
    expect(describeExerciseValuesDiff(base, { ...base })).toEqual([]);
    expect(
      describeExerciseValuesDiff(
        { ...base, load: null, loadUnit: "kg" },
        { ...base, load: null, loadUnit: "lb" },
      ),
    ).toEqual([]);
    expect(describeExerciseDiff(snap, { ...snap })).toEqual([]);
  });

  it("descreve mudanças de séries, reps, tempo, carga (com unidade e 0) e limpeza", () => {
    expect(
      describeExerciseValuesDiff(base, { sets: 4, reps: 12, durationSec: 45, load: 22.5, loadUnit: "kg" }),
    ).toEqual([
      "séries: 3 → 4",
      "repetições: 10 → 12",
      "tempo: — → 45s",
      "carga: 20 kg → 22,5 kg",
    ]);

    expect(
      describeExerciseValuesDiff(
        { sets: null, reps: null, durationSec: 60, load: 0, loadUnit: "kg" },
        { sets: null, reps: null, durationSec: 90, load: null, loadUnit: "kg" },
      ),
    ).toEqual(["tempo: 1min → 1min30s", "carga: 0 kg → —"]);

    expect(
      describeExerciseValuesDiff(base, { ...base, loadUnit: "lb" }),
    ).toEqual(["carga: 20 kg → 20 lb"]);
  });

  it("descreve mudanças de nome, descanso e observação no cadastro", () => {
    const diffs = describeExerciseDiff(snap, {
      ...snap,
      name: "Supino reto",
      restSec: 90,
      notes: null,
    });
    expect(diffs).toEqual([
      'nome: "Supino" → "Supino reto"',
      "descanso: 1min → 1min30s",
      'observação: "pegada fechada" → —',
    ]);
    expect(describePlanEdit(diffs)).toBe(
      'Editado no cadastro: nome: "Supino" → "Supino reto"; descanso: 1min → 1min30s; observação: "pegada fechada" → —',
    );
  });

  it("formata adição, remoção e ajuste no dia (plano atualizado x apenas neste dia)", () => {
    expect(describeExerciseAdded(snap)).toBe(
      "Adicionado à série (3×10 · 20 kg; descanso 1min; obs.: pegada fechada)",
    );
    expect(
      describeExerciseAdded({
        name: "Alongamento",
        sets: null,
        reps: null,
        durationSec: null,
        load: null,
        loadUnit: "kg",
        restSec: null,
        notes: null,
      }),
    ).toBe("Adicionado à série");
    expect(describeExerciseRemoved()).toBe("Removido da série");
    expect(describeDayValueAdjustment(["carga: 20 kg → 22,5 kg"], "2026-11-20", true)).toBe(
      "Ajuste no treino de 2026-11-20 (plano atualizado): carga: 20 kg → 22,5 kg",
    );
    expect(describeDayValueAdjustment(["carga: 20 kg → 18 kg"], "2026-11-18", false)).toBe(
      "Ajuste no registro de 2026-11-18 (apenas neste dia): carga: 20 kg → 18 kg",
    );
  });

  it("detecta reordenação apenas quando a ordem relativa dos exercícios mantidos muda", () => {
    expect(exerciseOrderChanged(["a", "b", "c"], ["a", "b", "c"])).toBe(false);
    // remover "a" não muda a ordem relativa de ["b", "c"]
    expect(exerciseOrderChanged(["a", "b", "c"], ["b", "c"])).toBe(false);
    // adicionar "d" no meio não muda a ordem relativa de ["a", "b", "c"]
    expect(exerciseOrderChanged(["a", "b", "c"], ["a", "d", "b", "c"])).toBe(false);
    // trocar "b" e "c" muda a ordem relativa
    expect(exerciseOrderChanged(["a", "b", "c"], ["a", "c", "b"])).toBe(true);
    expect(exerciseOrderChanged(["a", "b", "c"], ["c", "a"])).toBe(true);
  });
});
