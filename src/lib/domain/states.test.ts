import { describe, expect, it } from "vitest";
import {
  COMPLETION_STATUSES,
  STATE_CYCLE,
  STATE_META,
  isConclusive,
  isTaskState,
  nextState,
} from "./states";

describe("states", () => {
  it("ciclo rotaciona na ordem definida e volta ao início", () => {
    expect(STATE_CYCLE).toEqual(["NONE", "DONE", "CANCELLED", "HAPPY", "INDIFFERENT", "SAD"]);
    expect(nextState("NONE")).toBe("DONE");
    expect(nextState("DONE")).toBe("CANCELLED");
    expect(nextState("CANCELLED")).toBe("HAPPY");
    expect(nextState("HAPPY")).toBe("INDIFFERENT");
    expect(nextState("INDIFFERENT")).toBe("SAD");
    expect(nextState("SAD")).toBe("NONE");
  });

  it("humores concluem; NONE e CANCELLED não", () => {
    expect(isConclusive("DONE")).toBe(true);
    expect(isConclusive("HAPPY")).toBe(true);
    expect(isConclusive("INDIFFERENT")).toBe(true);
    expect(isConclusive("SAD")).toBe(true);
    expect(isConclusive("CANCELLED")).toBe(false);
    expect(isConclusive("NONE")).toBe(false);
  });

  it("isConclusive é seguro para valores desconhecidos", () => {
    expect(isConclusive("")).toBe(false);
    expect(isConclusive("done")).toBe(false);
    expect(isConclusive("WHATEVER")).toBe(false);
  });

  it("isTaskState valida os 6 estados", () => {
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
