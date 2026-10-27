import { describe, expect, it } from "vitest";
import {
  COMPLETION_STATUSES,
  STATE_CYCLE,
  STATE_META,
  isConclusive,
  isStateAllowed,
  isTaskState,
  nextState,
  nextStateAllowed,
  normalizeAllowedStates,
} from "./states";

describe("states", () => {
  it("ciclo rotaciona na ordem definida e volta ao início", () => {
    expect(STATE_CYCLE).toEqual(["NONE", "DONE", "CANCELLED", "HAPPY", "INDIFFERENT", "SAD", "BOMB"]);
    expect(nextState("NONE")).toBe("DONE");
    expect(nextState("DONE")).toBe("CANCELLED");
    expect(nextState("CANCELLED")).toBe("HAPPY");
    expect(nextState("HAPPY")).toBe("INDIFFERENT");
    expect(nextState("INDIFFERENT")).toBe("SAD");
    expect(nextState("SAD")).toBe("BOMB");
    expect(nextState("BOMB")).toBe("NONE");
  });

  it("humores e bomba concluem; NONE e CANCELLED não", () => {
    expect(isConclusive("DONE")).toBe(true);
    expect(isConclusive("HAPPY")).toBe(true);
    expect(isConclusive("INDIFFERENT")).toBe(true);
    expect(isConclusive("SAD")).toBe(true);
    expect(isConclusive("BOMB")).toBe(true);
    expect(isConclusive("CANCELLED")).toBe(false);
    expect(isConclusive("NONE")).toBe(false);
  });

  it("isConclusive é seguro para valores desconhecidos", () => {
    expect(isConclusive("")).toBe(false);
    expect(isConclusive("done")).toBe(false);
    expect(isConclusive("WHATEVER")).toBe(false);
  });

  it("isTaskState valida os 7 estados", () => {
    for (const s of STATE_CYCLE) expect(isTaskState(s)).toBe(true);
    expect(isTaskState("done")).toBe(false);
    expect(isTaskState(null)).toBe(false);
    expect(isTaskState(42)).toBe(false);
  });

  it("COMPLETION_STATUSES não inclui NONE; metadados cobrem todos os estados", () => {
    expect(COMPLETION_STATUSES).not.toContain("NONE");
    for (const s of STATE_CYCLE) {
      expect(STATE_META[s].label.length).toBeGreaterThan(0);
      expect(typeof STATE_META[s].conclusive).toBe("boolean");
    }
  });
});

describe("estados permitidos por tarefa", () => {
  it("null = sem restrição (todos marcáveis); NONE é sempre permitido", () => {
    for (const s of STATE_CYCLE) expect(isStateAllowed(null, s)).toBe(true);
    expect(isStateAllowed([], "NONE")).toBe(true); // mesmo sem nenhum marcável
  });

  it("array restringe aos estados listados", () => {
    const diet = ["DONE", "BOMB"] as const;
    expect(isStateAllowed([...diet], "DONE")).toBe(true);
    expect(isStateAllowed([...diet], "BOMB")).toBe(true);
    expect(isStateAllowed([...diet], "CANCELLED")).toBe(false);
    expect(isStateAllowed([...diet], "HAPPY")).toBe(false);
    expect(isStateAllowed([...diet], "NONE")).toBe(true);
  });

  it("ciclo pula estados não permitidos e sempre fecha em NONE", () => {
    // Dieta: NONE → DONE → BOMB → NONE (pula CANCELLED e humores)
    expect(nextStateAllowed("NONE", ["DONE", "BOMB"])).toBe("DONE");
    expect(nextStateAllowed("DONE", ["DONE", "BOMB"])).toBe("BOMB");
    expect(nextStateAllowed("BOMB", ["DONE", "BOMB"])).toBe("NONE");
    // Só check: vai e volta direto
    expect(nextStateAllowed("NONE", ["DONE"])).toBe("DONE");
    expect(nextStateAllowed("DONE", ["DONE"])).toBe("NONE");
    // Estado atual fora da lista (restrição apertada depois da marcação):
    // avança a partir dele no ciclo global até o próximo permitido
    expect(nextStateAllowed("SAD", ["DONE"])).toBe("NONE");
    expect(nextStateAllowed("HAPPY", ["DONE", "BOMB"])).toBe("BOMB");
    // Sem restrição = ciclo clássico
    expect(nextStateAllowed("SAD", null)).toBe("BOMB");
  });

  it("normalizeAllowedStates: não-array/vazio → null; filtra lixo e NONE; ordena", () => {
    expect(normalizeAllowedStates(undefined)).toBeNull();
    expect(normalizeAllowedStates(null)).toBeNull();
    expect(normalizeAllowedStates("DONE")).toBeNull();
    expect(normalizeAllowedStates([])).toBeNull(); // convenção do banco: vazio = todos
    expect(normalizeAllowedStates(["BOMB"])).toEqual(["BOMB"]);
    // ordem canônica independente da entrada; duplicatas somem
    expect(normalizeAllowedStates(["BOMB", "DONE", "DONE"])).toEqual(["DONE", "BOMB"]);
    expect(normalizeAllowedStates(["SAD", "CANCELLED", "HAPPY"])).toEqual(["CANCELLED", "HAPPY", "SAD"]);
    // NONE e valores desconhecidos são descartados; só lixo → null
    expect(normalizeAllowedStates(["NONE"])).toBeNull();
    expect(normalizeAllowedStates(["x", 42])).toBeNull();
    expect(normalizeAllowedStates(["NONE", "BOMB"])).toEqual(["BOMB"]);
  });
});
