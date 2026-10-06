import { describe, expect, it } from "vitest";

import { addDays, type CompletionLike, type TaskLike } from "./schedule";
import {
  buildStatsPayload,
  clampStatsRange,
  diffDays,
  formatLocalDate,
  type StatusCounts,
} from "./stats";

const TODAY = "2026-10-06"; // terça-feira

function task(id: string, over: Partial<TaskLike> = {}): TaskLike {
  return {
    id,
    name: id,
    active: true,
    scheduleType: "WEEKLY",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    monthDay: null,
    time: "08:00",
    anchorId: null,
    offsetMinutes: null,
    ...over,
  };
}

function mark(taskId: string, D: string, status = "DONE"): CompletionLike {
  return { taskId, localDate: D, completedAt: new Date(), status };
}

/** "Seg 2026-09-07" helpers — semana de teste fixa (dom 06/09 a sáb 12/09). */
const WEEK = { from: "2026-09-06", to: "2026-09-12" };

describe("clampStatsRange", () => {
  it("ausente/inválido → últimos 7 dias terminando hoje", () => {
    expect(clampStatsRange(null, null, TODAY)).toEqual({ from: "2026-09-30", to: TODAY });
    expect(clampStatsRange("x", "2026-13-45", TODAY)).toEqual({ from: "2026-09-30", to: TODAY });
  });

  it("`to` no futuro → hoje", () => {
    expect(clampStatsRange("2026-09-01", "2026-12-25", TODAY)).toEqual({
      from: "2026-09-01",
      to: TODAY,
    });
  });

  it("`from > to` → troca", () => {
    expect(clampStatsRange("2026-10-05", "2026-09-01", TODAY)).toEqual({
      from: "2026-09-01",
      to: "2026-10-05",
    });
  });

  it("intervalo > 400 dias → clamp para 400 dias terminando em `to`", () => {
    const r = clampStatsRange("2024-01-01", TODAY, TODAY);
    expect(r.to).toBe(TODAY);
    expect(diffDays(r.from, r.to)).toBe(399); // 400 dias contando as pontas
  });

  it("from ausente deriva de `to` válido", () => {
    expect(clampStatsRange(null, "2026-08-31", TODAY)).toEqual({ from: "2026-08-25", to: "2026-08-31" });
  });
});

describe("buildStatsPayload", () => {
  it("conta marcações por status por tarefa e global", () => {
    const tasks = [task("a"), task("b")];
    const completions = [
      mark("a", "2026-09-06"),
      mark("a", "2026-09-07", "HAPPY"),
      mark("a", "2026-09-08", "CANCELLED"),
      mark("b", "2026-09-09", "SAD"),
      mark("b", "2026-09-10", "INDIFFERENT"),
    ];
    const p = buildStatsPayload(tasks, completions, WEEK.from, WEEK.to, TODAY);
    expect(p.totals).toEqual<StatusCounts>({
      DONE: 1,
      HAPPY: 1,
      INDIFFERENT: 1,
      SAD: 1,
      CANCELLED: 1,
    });
    expect(p.tasks[0].counts).toMatchObject({ DONE: 1, HAPPY: 1, CANCELLED: 1 }); // "a"
    expect(p.tasks[1].counts).toMatchObject({ SAD: 1, INDIFFERENT: 1 }); // "b"
    expect(p.totalDue).toBe(14); // 2 tarefas × 7 dias
    expect(p.days).toBe(7);
  });

  it("due semanal e mensal cruzando a virada de mês", () => {
    const weekly = task("segunda", { weekdays: [1] }); // segundas
    const monthly = task("dia1", { scheduleType: "MONTHLY", monthDay: 1 });
    const p = buildStatsPayload(
      [weekly, monthly],
      [],
      "2026-08-25",
      "2026-10-05",
      TODAY,
    );
    const weeklyRow = p.tasks.find((t) => t.taskId === "segunda")!;
    const monthlyRow = p.tasks.find((t) => t.taskId === "dia1")!;
    // 25/08 a 05/10: segundas 31/08, 07, 14, 21, 28/09 e 05/10 → 6
    expect(weeklyRow.due).toBe(6);
    // 01/09 e 01/10 (01/08 fora do intervalo)
    expect(monthlyRow.due).toBe(2);
  });

  it("missed = due − marcadas (clamp ≥ 0); marcação em dia não previsto conta como marcada", () => {
    const monday = task("m", { weekdays: [1] }); // 07/09 na semana de teste
    const completions = [
      mark("m", "2026-09-07"), // dia devido
      mark("m", "2026-09-09"), // não devido
      mark("m", "2026-09-10"), // não devido
    ];
    const p = buildStatsPayload([monday], completions, WEEK.from, WEEK.to, TODAY);
    expect(p.tasks[0].due).toBe(1);
    expect(p.tasks[0].marked).toBe(3);
    expect(p.tasks[0].missed).toBe(0); // clamp
    expect(p.tasks[0].conclusionRate).toBe(1); // clamp superior
  });

  it("missed acumula dias previstos sem registro", () => {
    const weekdays3 = task("w", { weekdays: [1, 2, 3] }); // seg, ter, qua
    const completions = [mark("w", "2026-09-07")]; // só segunda
    const p = buildStatsPayload([weekdays3], completions, WEEK.from, WEEK.to, TODAY);
    expect(p.tasks[0].due).toBe(3);
    expect(p.tasks[0].marked).toBe(1);
    expect(p.tasks[0].missed).toBe(2);
    expect(p.tasks[0].conclusionRate).toBeCloseTo(1 / 3);
  });

  it("tarefa inativa conta no histórico (due ignora active)", () => {
    const inactive = task("off", { active: false, weekdays: [0] }); // 06/09
    const p = buildStatsPayload([inactive], [], WEEK.from, WEEK.to, TODAY);
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0].due).toBe(1);
    expect(p.tasks[0].missed).toBe(1);
    expect(p.totalDue).toBe(1);
  });

  it("status desconhecido no banco degrada para DONE", () => {
    const completions = [mark("a", "2026-09-06", "WHATEVER")];
    const p = buildStatsPayload([task("a")], completions, WEEK.from, WEEK.to, TODAY);
    expect(p.totals.DONE).toBe(1);
    expect(p.totals.CANCELLED).toBe(0);
    expect(p.tasks[0].counts.DONE).toBe(1);
  });

  it("ordena por marcadas desc e desempata por nome", () => {
    const tasks = [task("B"), task("a"), task("C")];
    const completions = [mark("a", "2026-09-06"), mark("C", "2026-09-07"), mark("C", "2026-09-08")];
    const p = buildStatsPayload(tasks, completions, WEEK.from, WEEK.to, TODAY);
    expect(p.tasks.map((t) => t.taskId)).toEqual(["C", "a", "B"]);
  });

  it("exclui tarefas sem ocorrência e sem marcação no intervalo", () => {
    const p = buildStatsPayload(
      [task("presente", { weekdays: [1] }), task("nunca", { weekdays: [] })],
      [mark("presente", "2026-09-07")],
      WEEK.from,
      WEEK.to,
      TODAY,
    );
    expect(p.tasks.map((t) => t.taskId)).toEqual(["presente"]);
  });

  it("intervalo vazio → zeros sem tarefas, buckets zerados e taxa 0", () => {
    const p = buildStatsPayload([], [], WEEK.from, WEEK.to, TODAY);
    expect(p.totals).toEqual<StatusCounts>({
      DONE: 0,
      HAPPY: 0,
      INDIFFERENT: 0,
      SAD: 0,
      CANCELLED: 0,
    });
    expect(p.tasks).toEqual([]);
    expect(p.totalDue).toBe(0);
    expect(p.conclusionRate).toBe(0);
    expect(p.buckets).toHaveLength(7);
    for (const b of p.buckets) {
      expect(b.marked).toBe(0);
      expect(b.due).toBe(0);
      expect(b.rate).toBeNull();
    }
  });

  it("taxa global = conclusivos/totalDue (humores concluem, cancelamento não)", () => {
    const completions = [
      mark("a", "2026-09-06"),
      mark("a", "2026-09-07", "HAPPY"),
      mark("a", "2026-09-08", "CANCELLED"),
      mark("a", "2026-09-09", "SAD"),
    ];
    const p = buildStatsPayload([task("a")], completions, WEEK.from, WEEK.to, TODAY);
    // 3 conclusivos (DONE, HAPPY, SAD) de 7 devidas
    expect(p.conclusionRate).toBeCloseTo(3 / 7);
  });

  it("marcações fora do intervalo são ignoradas", () => {
    const completions = [mark("a", "2026-09-05"), mark("a", "2026-09-13")];
    const p = buildStatsPayload([task("a")], completions, WEEK.from, WEEK.to, TODAY);
    expect(p.totals.DONE).toBe(0);
    // a tarefa entra por due ≥ 1 (WEEKLY diária), mas sem marcações
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0].marked).toBe(0);
    expect(p.tasks[0].missed).toBe(7);
  });

  it("respeita clamp do intervalo (to futuro → hoje)", () => {
    const p = buildStatsPayload([task("a")], [], "2026-09-01", "2026-12-25", TODAY);
    expect(p.from).toBe("2026-09-01");
    expect(p.to).toBe(TODAY);
    expect(p.days).toBe(diffDays("2026-09-01", TODAY) + 1);
  });
});

describe("bucketing", () => {
  it("≤ 45 dias → diário; ≤ 7 dias usa dia da semana como label", () => {
    const p = buildStatsPayload([], [], WEEK.from, WEEK.to, TODAY);
    expect(p.bucketKind).toBe("day");
    expect(p.buckets.map((b) => b.label)).toEqual([
      "dom",
      "seg",
      "ter",
      "qua",
      "qui",
      "sex",
      "sáb",
    ]);
  });

  it("45 dias ainda é diário com label 'd MMM'", () => {
    const from = "2026-01-01";
    const to = addDays(from, 44);
    const p = buildStatsPayload([], [], from, to, TODAY);
    expect(p.bucketKind).toBe("day");
    expect(p.buckets).toHaveLength(45);
    expect(p.buckets[0].label).toBe("1 jan");
  });

  it("46–200 dias → semanal em blocos de 7 terminando em `to`", () => {
    const from = "2026-07-01";
    const to = addDays(from, 59); // 60 dias
    const p = buildStatsPayload([], [], from, to, TODAY);
    expect(p.bucketKind).toBe("week");
    expect(p.buckets).toHaveLength(9); // ceil(60/7)
    expect(p.buckets[0].start).toBe(from);
    expect(p.buckets.at(-1)!.end).toBe(to);
    for (const b of p.buckets) {
      expect(diffDays(b.start, b.end)).toBeLessThanOrEqual(6);
    }
    // contíguos: o fim de um bucket + 1 = início do próximo
    for (let i = 1; i < p.buckets.length; i += 1) {
      expect(addDays(p.buckets[i - 1].end, 1)).toBe(p.buckets[i].start);
    }
  });

  it("200 dias ainda é semanal; 201 vira mensal", () => {
    const from = "2026-01-01";
    expect(buildStatsPayload([], [], from, addDays(from, 199), TODAY).bucketKind).toBe("week");
    expect(buildStatsPayload([], [], from, addDays(from, 200), TODAY).bucketKind).toBe("month");
  });

  it("> 200 dias → meses calendário, com pontas parciais", () => {
    const p = buildStatsPayload([], [], "2026-01-10", "2026-12-20", "2026-12-31");
    expect(p.bucketKind).toBe("month");
    expect(p.buckets).toHaveLength(12);
    expect(p.buckets[0]).toMatchObject({ start: "2026-01-10", end: "2026-01-31" });
    expect(p.buckets[1]).toMatchObject({ start: "2026-02-01", end: "2026-02-28" });
    expect(p.buckets.at(-1)).toMatchObject({ start: "2026-12-01", end: "2026-12-20" });
    expect(p.buckets[0].label).toBe("jan 2026");
  });

  it("acumula counts/due/marcadas por bucket e taxa por bucket", () => {
    const daily = task("d"); // todos os dias
    const completions = [mark("d", "2026-09-06"), mark("d", "2026-09-07", "CANCELLED")];
    const p = buildStatsPayload([daily], completions, WEEK.from, WEEK.to, TODAY);
    const [dom, seg] = p.buckets;
    expect(dom.due).toBe(1);
    expect(dom.marked).toBe(1);
    expect(dom.counts.DONE).toBe(1);
    expect(dom.rate).toBe(1);
    expect(seg.due).toBe(1);
    expect(seg.counts.CANCELLED).toBe(1);
    expect(seg.rate).toBe(0); // cancelado não é conclusivo
  });

  it("duas marcações da mesma tarefa no mesmo dia: a última vence", () => {
    const completions = [
      mark("d", "2026-09-06", "DONE"),
      mark("d", "2026-09-06", "CANCELLED"),
    ];
    const p = buildStatsPayload([task("d")], completions, WEEK.from, WEEK.to, TODAY);
    expect(p.totals.DONE).toBe(0);
    expect(p.totals.CANCELLED).toBe(1);
    expect(p.buckets[0].marked).toBe(1); // não duplica
  });

  it("bucket sem tarefa devida → rate null", () => {
    const monday = task("m", { weekdays: [1] }); // só 07/09
    const p = buildStatsPayload([monday], [mark("m", "2026-09-07")], WEEK.from, WEEK.to, TODAY);
    expect(p.buckets[0].rate).toBeNull(); // domingo sem previsão
    expect(p.buckets[1].rate).toBe(1);
  });
});

describe("formatLocalDate", () => {
  it("formata pt-BR sem depender do fuso de execução", () => {
    expect(formatLocalDate("2026-10-05", "d MMM")).toBe("5 out");
    expect(formatLocalDate("2026-10-05", "EEEE, d 'de' MMMM 'de' yyyy")).toBe(
      "segunda-feira, 5 de outubro de 2026",
    );
  });
});
