import { describe, expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import {
  addDays,
  alarmName,
  dateInTZ,
  due,
  effectiveAt,
  formatShift,
  isValidLocalDate,
  nextOccurrence,
  nominal,
  shiftOf,
  type CompletionLike,
  type TaskLike,
  type TasksById,
} from "./schedule";

const TZ = "America/Sao_Paulo"; // UTC−3, sem DST desde 2019
const D = "2026-10-01"; // quinta-feira (getDay === 4)

function task(p: Partial<TaskLike> & Pick<TaskLike, "id">): TaskLike {
  return {
    name: p.id,
    active: true,
    scheduleType: "WEEKLY",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    monthDay: null,
    time: null,
    anchorId: null,
    offsetMinutes: null,
    ...p,
  };
}

/** Conclusão CONCLUSIVA da tarefa `taskId` na data D, registrada às `hhmm` locais. */
function done(taskId: string, day: string, hhmm: string): CompletionLike {
  return marked(taskId, day, hhmm, "DONE");
}

/** Registro da tarefa `taskId` na data D com status arbitrário. */
function marked(taskId: string, day: string, hhmm: string, status: string): CompletionLike {
  return { taskId, localDate: day, completedAt: fromZonedTime(`${day}T${hhmm}:00`, TZ), status };
}

/** Instante UTC correspondente a hhmm locais em D. */
const at = (hhmm: string, day = D) => fromZonedTime(`${day}T${hhmm}:00`, TZ).getTime();

const tasksOf = (...ts: TaskLike[]): TasksById => new Map(ts.map((t) => [t.id, t]));
const compsOf = (...cs: CompletionLike[]) => new Map(cs.map((c) => [c.taskId, c]));

// ---------------------------------------------------------------------------
// due — semanal e mensal (dia 31 não "vaza")
// ---------------------------------------------------------------------------

describe("due", () => {
  it("semanal: contém o getDay da data", () => {
    expect(due(task({ id: "t", weekdays: [4] }), D)).toBe(true);
    expect(due(task({ id: "t", weekdays: [1, 3] }), D)).toBe(false);
    expect(due(task({ id: "t", weekdays: [] }), D)).toBe(false);
  });

  it("mensal: dia 31 em fevereiro → não ocorre (sem vazar para o último dia)", () => {
    const t = task({ id: "t", scheduleType: "MONTHLY", weekdays: [], monthDay: 31 });
    expect(due(t, "2026-01-31")).toBe(true);
    expect(due(t, "2026-02-28")).toBe(false); // fev/2026 tem 28 dias
    expect(due(t, "2026-04-30")).toBe(false); // abril tem 30 — não vaza
    expect(due(t, "2028-02-29")).toBe(false); // nem em ano bissexto
  });
});

// ---------------------------------------------------------------------------
// nominal — DST-correct
// ---------------------------------------------------------------------------

describe("nominal", () => {
  it("converte D + HH:mm para UTC no fuso do usuário", () => {
    expect(nominal(task({ id: "t", time: "08:00" }), D, TZ)?.getTime()).toBe(at("08:00"));
    expect(nominal(task({ id: "t", time: "00:00" }), D, TZ)?.getTime()).toBe(at("00:00"));
  });

  it("tarefa sem hora → undefined", () => {
    expect(nominal(task({ id: "t" }), D, TZ)).toBeUndefined();
  });

  it("DST: horário na virada do fuso é convertido corretamente", () => {
    const ny = "America/New_York";
    const t = task({ id: "t", time: "08:00" });
    // 2027-03-14 é o início do DST (EDT, UTC−4); 2027-03-13 ainda é EST (UTC−5).
    expect(nominal(t, "2027-03-14", ny)?.toISOString()).toBe("2027-03-14T12:00:00.000Z");
    expect(nominal(t, "2027-03-13", ny)?.toISOString()).toBe("2027-03-13T13:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// effective — variantes (a)–(e) + marcação atrasada/adiantada + cadeia
// ---------------------------------------------------------------------------

describe("effectiveAt", () => {
  const A = task({ id: "a", time: "08:00" });
  const B = task({ id: "b", time: "08:30", anchorId: "a" });
  const C = task({ id: "c", time: "09:00", anchorId: "b" });
  const tasks = tasksOf(A, B, C);

  it("(a) sem âncora, com hora → nominal", () => {
    expect(effectiveAt(A, D, TZ, compsOf(), tasks)?.getTime()).toBe(at("08:00"));
  });

  it("(b) com hora, âncora concluída → nominal + delta da âncora", () => {
    // Exemplo canônico: A=08:00 marcada 08:05 → B efetivo 08:35.
    const comps = compsOf(done("a", D, "08:05"));
    expect(effectiveAt(B, D, TZ, comps, tasks)?.getTime()).toBe(at("08:35"));
    // Marcação adiantada (simétrica): A marcada 07:50 → B efetivo 08:20.
    const early = compsOf(done("a", D, "07:50"));
    expect(effectiveAt(B, D, TZ, early, tasks)?.getTime()).toBe(at("08:20"));
  });

  it("(c) com hora, âncora pendente → nominal + shift herdado da cadeia", () => {
    // Âncora pendente e sem âncora própria → shift 0 → nominal.
    expect(effectiveAt(B, D, TZ, compsOf(), tasks)?.getTime()).toBe(at("08:30"));
    // Cadeia A→B→C: A marcada 08:10, B pendente → C herda o +10 de A.
    const comps = compsOf(done("a", D, "08:10"));
    expect(effectiveAt(C, D, TZ, comps, tasks)?.getTime()).toBe(at("09:10"));
  });

  it("(d) sem hora, âncora concluída → completedAt(âncora) + offsetMinutes", () => {
    const noTime = task({ id: "n", anchorId: "a", offsetMinutes: 20 });
    const all = tasksOf(A, noTime);
    const comps = compsOf(done("a", D, "08:05"));
    expect(effectiveAt(noTime, D, TZ, comps, all)?.getTime()).toBe(at("08:25"));
  });

  it("(e) sem hora, âncora pendente → undefined; sem hora e sem âncora → undefined", () => {
    const noTime = task({ id: "n", anchorId: "a", offsetMinutes: 20 });
    expect(effectiveAt(noTime, D, TZ, compsOf(), tasksOf(A, noTime))).toBeUndefined();
    expect(effectiveAt(task({ id: "x" }), D, TZ, compsOf(), tasks)).toBeUndefined();
  });

  it("cadeia A→B→C: shift próprio quando B marcada, herdado de A enquanto B pendente", () => {
    // B marcada 08:35 (+5 próprio) → C = 09:05 (shift vem de B).
    const own = compsOf(done("a", D, "08:10"), done("b", D, "08:35"));
    expect(effectiveAt(C, D, TZ, own, tasks)?.getTime()).toBe(at("09:05"));
    // B pendente → C herda o shift de A (+10).
    const inherited = compsOf(done("a", D, "08:10"));
    expect(effectiveAt(C, D, TZ, inherited, tasks)?.getTime()).toBe(at("09:10"));
  });

  it("desfazer a conclusão da âncora volta a dependente ao nominal", () => {
    expect(effectiveAt(B, D, TZ, compsOf(done("a", D, "08:05")), tasks)?.getTime()).toBe(at("08:35"));
    expect(effectiveAt(B, D, TZ, compsOf(), tasks)?.getTime()).toBe(at("08:30"));
  });

  it("shift negativo (adiantamento) também se propaga", () => {
    const comps = compsOf(done("a", D, "07:30"));
    expect(shiftOf(B, D, TZ, comps, tasks)).toBe(-30 * 60_000);
    expect(effectiveAt(B, D, TZ, comps, tasks)?.getTime()).toBe(at("08:00"));
  });

  it("humores são conclusivos: deslocam a cadeia como DONE", () => {
    const comps = compsOf(marked("a", D, "08:05", "HAPPY"));
    expect(effectiveAt(B, D, TZ, comps, tasks)?.getTime()).toBe(at("08:35"));
    const noTime = task({ id: "n", anchorId: "a", offsetMinutes: 20 });
    expect(effectiveAt(noTime, D, TZ, comps, tasksOf(A, noTime))?.getTime()).toBe(at("08:25"));
  });

  it("âncora CANCELADA não desloca a cadeia (dependente fica no nominal)", () => {
    const comps = compsOf(marked("a", D, "09:30", "CANCELLED"));
    expect(shiftOf(B, D, TZ, comps, tasks)).toBe(0);
    expect(effectiveAt(B, D, TZ, comps, tasks)?.getTime()).toBe(at("08:30"));
  });

  it("sem hora com âncora CANCELADA → undefined (igual âncora pendente)", () => {
    const noTime = task({ id: "n", anchorId: "a", offsetMinutes: 20 });
    const comps = compsOf(marked("a", D, "09:30", "CANCELLED"));
    expect(effectiveAt(noTime, D, TZ, comps, tasksOf(A, noTime))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// nextOccurrence / addDays
// ---------------------------------------------------------------------------

describe("nextOccurrence", () => {
  it("atravessa a semana até o weekday devido", () => {
    expect(nextOccurrence(task({ id: "t", weekdays: [0] }), D)).toBe("2026-10-04"); // qui → dom
  });

  it("atravessa o mês", () => {
    expect(nextOccurrence(task({ id: "t", weekdays: [1] }), "2026-09-28")).toBe("2026-10-05");
    // dia 31: pula fevereiro inteiro (28 dias) → março.
    expect(
      nextOccurrence(task({ id: "t", scheduleType: "MONTHLY", weekdays: [], monthDay: 31 }), "2026-01-31"),
    ).toBe("2026-03-31");
  });

  it("sem dias configurados → null", () => {
    expect(nextOccurrence(task({ id: "t", weekdays: [] }), D)).toBeNull();
  });
});

describe("addDays / dateInTZ", () => {
  it("virada de mês e de ano", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("dateInTZ usa o fuso informado", () => {
    // 2026-10-01T23:30Z ainda é 20:30 em São Paulo (mesmo dia) e 2026-10-02 em Tóquio.
    const dt = new Date("2026-10-01T23:30:00Z");
    expect(dateInTZ(dt, "America/Sao_Paulo")).toBe("2026-10-01");
    expect(dateInTZ(dt, "Asia/Tokyo")).toBe("2026-10-02");
  });
});

describe("isValidLocalDate", () => {
  it("aceita datas reais no formato YYYY-MM-DD", () => {
    expect(isValidLocalDate("2026-10-01")).toBe(true);
    expect(isValidLocalDate("2024-02-29")).toBe(true); // ano bissexto
  });

  it("rejeita formato inválido e datas inexistentes", () => {
    expect(isValidLocalDate("2026-10-1")).toBe(false);
    expect(isValidLocalDate("2026/10/01")).toBe(false);
    expect(isValidLocalDate("")).toBe(false);
    expect(isValidLocalDate("2026-13-01")).toBe(false); // mês 13
    expect(isValidLocalDate("2026-00-10")).toBe(false); // mês 0
    expect(isValidLocalDate("2026-04-31")).toBe(false); // abril não tem 31
    expect(isValidLocalDate("2023-02-29")).toBe(false); // não bissexto
  });
});

// ---------------------------------------------------------------------------
// Nomes determinísticos de alarme
// ---------------------------------------------------------------------------

describe("alarmName", () => {
  it("é determinístico e inclui taskId, localDate e epoch do scheduleTime", () => {
    const when = new Date(at("08:00"));
    const name = alarmName("t1", D, when);
    expect(name).toBe(`alarm-t1-${D}-${when.getTime()}`);
    expect(alarmName("t1", D, when)).toBe(name);
    expect(alarmName("t1", D, new Date(at("08:30")))).not.toBe(name);
  });
});

describe("formatShift", () => {
  it("formata minutos com sinal (e vazio para zero)", () => {
    expect(formatShift(5 * 60_000)).toBe("+5 min");
    expect(formatShift(-10 * 60_000)).toBe("−10 min");
    expect(formatShift(0)).toBe("");
  });
});
