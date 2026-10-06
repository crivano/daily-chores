import { describe, expect, it } from "vitest";
import { compareTaskDTOs, type TaskDTO } from "./dto";

const t = (name: string, time: string | null): TaskDTO => ({
  id: name,
  name,
  active: true,
  scheduleType: "WEEKLY",
  weekdays: [1, 2, 3, 4, 5],
  monthDay: null,
  time,
  anchorId: null,
  offsetMinutes: null,
  dependents: [],
});

const names = (tasks: TaskDTO[]) => tasks.map((x) => x.name);

describe("compareTaskDTOs", () => {
  it("tarefas sem hora vêm primeiro, em ordem alfabética", () => {
    const sorted = [t("Banho", null), t("Café", "07:00"), t("Água", null)].sort(compareTaskDTOs);
    expect(names(sorted)).toEqual(["Água", "Banho", "Café"]);
  });

  it("tarefas com hora ficam em ordem cronológica", () => {
    const sorted = [t("Jantar", "20:00"), t("Café", "07:00"), t("Almoço", "12:30")].sort(compareTaskDTOs);
    expect(names(sorted)).toEqual(["Café", "Almoço", "Jantar"]);
  });

  it("empate de horário desempata alfabeticamente", () => {
    const sorted = [t("Escova", "07:00"), t("Café", "07:00")].sort(compareTaskDTOs);
    expect(names(sorted)).toEqual(["Café", "Escova"]);
  });

  it("sem hora vem antes mesmo de 00:00", () => {
    const sorted = [t("Madrugada", "00:00"), t("Livre", null)].sort(compareTaskDTOs);
    expect(names(sorted)).toEqual(["Livre", "Madrugada"]);
  });
});
