import { describe, expect, it } from "vitest";
import { compareTaskDTOs, compareTasksByTimeName, type TaskDTO } from "./dto";

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

describe("compareTasksByTimeName", () => {
  // Contrato usado por getDayPayload (tela "Hoje"): a ordem do dia é função só
  // de {time, name} — completions não entram na assinatura, então marcar uma
  // tarefa (ou a âncora dela) jamais reposiciona linhas da lista.

  it("seção com hora: ordem cronológica da hora fixa, empate desempata por nome", () => {
    const rows = [
      { name: "Escova", time: "07:00" },
      { name: "Jantar", time: "20:00" },
      { name: "Café", time: "07:00" },
    ].sort(compareTasksByTimeName);
    expect(rows.map((r) => r.name)).toEqual(["Café", "Escova", "Jantar"]);
  });

  it("seção sem hora: entre si fica em A→Z (estável mesmo após concluir âncoras)", () => {
    const rows = [
      { name: "Vitamina C", time: null },
      { name: "Água", time: null },
    ].sort(compareTasksByTimeName);
    expect(rows.map((r) => r.name)).toEqual(["Água", "Vitamina C"]);
  });
});
