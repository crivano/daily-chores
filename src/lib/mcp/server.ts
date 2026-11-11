/**
 * Servidor MCP do Daily Chores (SDK v2, @modelcontextprotocol/server) —
 * exposto em /api/mcp. Cada requisição constrói um McpServer amarrado ao
 * usuário do token OAuth (factory por requisição, sem estado entre chamadas).
 *
 * As ferramentas NÃO reimplementam regra nenhuma: delegam aos mesmos
 * serviços das rotas REST (taskService, completions, exercises, day, stats),
 * que por sua vez chamam lib/domain/ — inclusive o re-sync dos alarmes.
 */
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { setCompletion } from "../completions";
import { getDayPayload } from "../day";
import { DEFAULT_TZ, dateInTZ } from "../domain/schedule";
import { buildTaskDTOs, compareTaskDTOs } from "../dto";
import { setExerciseLog } from "../exercises";
import { prisma } from "../prisma";
import { getStatsPayload } from "../stats";
import { createTask, deleteTask, updateTask } from "../taskService";
import { getWorkoutHistory } from "../workoutHistory";

const INSTRUCTIONS = `Daily Chores é o app de rotinas diárias do usuário (UI em pt-BR). Converse com ele em português.

Conceitos:
- Tarefa recorrente: scheduleType "WEEKLY" (weekdays: 0=domingo … 6=sábado) ou "MONTHLY" (monthDay 1..31; meses sem o dia não ocorrem). time "HH:mm" opcional (sem hora = tarefa sem horário fixo). Notificação push no horário.
- Tarefa relativa: anchorTaskId aponta para outra tarefa. Com time, a âncora também precisa ter hora e o atraso da âncora desloca a dependente. Sem time, offsetMinutes (≥ 0) é obrigatório: notifica X min após a âncora ser concluída. A cadeia inteira precisa ter a mesma recorrência; ciclos são proibidos; não dá para excluir uma âncora com dependentes.
- Estados do dia: NONE (não marcado), DONE (feito), CANCELLED (cancelado — silencia mas não conta), HAPPY/INDIFFERENT/SAD (feito com humor), BOMB (falha registrada, ex.: estourou a dieta). allowedStates restringe os estados marcáveis (null/[] = todos).
- Séries de exercícios: kind "WORKOUT" com lista de exercícios (sets, reps, durationSec, load + loadUnit kg|lb, restSec, notes). Marcar o último exercício do dia conclui a tarefa automaticamente. Ajustar valores de um exercício HOJE muda o plano dos próximos treinos.
- Datas são "YYYY-MM-DD" no fuso do usuário; marcações valem para dias passados (correção) e futuros (adiantar). list_tasks e get_day informam a data de hoje.

Boas práticas: consulte list_tasks antes de criar/alterar (para obter ids e evitar duplicatas); confirme com o usuário antes de excluir tarefas; em update_task com exercises, envie a lista COMPLETA (com o id dos exercícios mantidos — omitidos são arquivados).`;

const STATE_VALUES = ["DONE", "CANCELLED", "HAPPY", "INDIFFERENT", "SAD", "BOMB"] as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const TIME = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");

const exerciseSchema = z.object({
  id: z.string().optional().describe("Id de exercício existente (preserva o histórico). Omita para criar um novo."),
  name: z.string().describe("Nome do exercício (máx. 80)."),
  sets: z.number().int().min(1).max(99).nullable().optional().describe("Séries."),
  reps: z.number().int().min(1).max(999).nullable().optional().describe("Repetições por série."),
  durationSec: z.number().int().min(1).max(36000).nullable().optional().describe("Duração em segundos (exercícios por tempo)."),
  load: z.number().min(0).max(9999).nullable().optional().describe("Carga."),
  loadUnit: z.enum(["kg", "lb"]).optional().describe("Unidade da carga (padrão kg)."),
  restSec: z.number().int().min(0).max(3600).nullable().optional().describe("Descanso em segundos."),
  notes: z.string().max(300).nullable().optional().describe("Observações."),
});

const taskFields = {
  name: z.string().describe("Nome da tarefa (máx. 80)."),
  scheduleType: z.enum(["WEEKLY", "MONTHLY"]).describe("Recorrência."),
  weekdays: z.array(z.number().int().min(0).max(6)).describe("WEEKLY: dias da semana, 0=domingo … 6=sábado."),
  monthDay: z.number().int().min(1).max(31).nullable().describe("MONTHLY: dia do mês."),
  time: TIME.nullable().describe("Horário fixo HH:mm; null = sem hora."),
  anchorTaskId: z.string().nullable().describe("Id da tarefa âncora (tarefa relativa); null = independente."),
  offsetMinutes: z.number().int().min(0).nullable().describe("Relativa sem hora: minutos após a âncora ser concluída."),
  allowedStates: z.array(z.enum(STATE_VALUES)).nullable().describe("Estados marcáveis; null ou [] = todos."),
  active: z.boolean().describe("false desativa (sem notificações) sem excluir."),
  kind: z.enum(["SIMPLE", "WORKOUT"]).describe("WORKOUT = série de exercícios (exige exercises)."),
  exercises: z
    .array(exerciseSchema)
    .describe("Lista COMPLETA de exercícios da série, na ordem de execução. Exercícios ativos omitidos são arquivados."),
};

// Criação: só nome e recorrência são obrigatórios; patch: tudo opcional + taskId.
const createSchema = z.object(taskFields).partial().required({ name: true, scheduleType: true });
const updateSchema = z
  .object(taskFields)
  .partial()
  .extend({ taskId: z.string().describe("Id da tarefa.") });

function json(data: unknown): CallToolResult {
  // JSON compacto: indentação só gastaria contexto do modelo.
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function fail(message: string, extra?: string[]): CallToolResult {
  const text = extra?.length ? `${message}\n${extra.map((n) => `- ${n}`).join("\n")}` : message;
  return { content: [{ type: "text", text }], isError: true };
}

async function todayFor(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const timezone = user?.timezone ?? DEFAULT_TZ;
  return { timezone, today: dateInTZ(new Date(), timezone) };
}

export function buildMcpServer(userId: string): McpServer {
  const server = new McpServer(
    { name: "daily-chores", title: "Daily Chores", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  // ---------------- leitura ----------------

  server.registerTool(
    "list_tasks",
    {
      title: "Listar tarefas",
      description:
        "Lista todas as tarefas cadastradas (ativas e inativas) com recorrência, horário, âncora, estados permitidos e exercícios das séries. Também informa o fuso e a data de hoje.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const tasks = await prisma.task.findMany({
        where: { userId },
        include: { exercises: { where: { archivedAt: null }, orderBy: { position: "asc" } } },
      });
      return json({ ...(await todayFor(userId)), tasks: buildTaskDTOs(tasks).sort(compareTaskDTOs) });
    },
  );

  server.registerTool(
    "get_day",
    {
      title: "Ver o dia",
      description:
        "Tarefas devidas em um dia (hoje por padrão) com o estado de cada uma, horários previstos/executados, progresso e, nas séries, os exercícios marcados.",
      inputSchema: z.object({ date: DATE.optional().describe("Dia YYYY-MM-DD (padrão: hoje; passado ou futuro).") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date }) => json(await getDayPayload(userId, date ?? null)),
  );

  server.registerTool(
    "get_stats",
    {
      title: "Estatísticas",
      description:
        "Estatísticas de um intervalo (padrão: últimos 7 dias): por tarefa, quantas vezes era devida, contagem por estado, faltas e taxa de conclusão; e a série temporal agregada (dia/semana/mês).",
      inputSchema: z.object({
        from: DATE.optional().describe("Início YYYY-MM-DD (inclusive)."),
        to: DATE.optional().describe("Fim YYYY-MM-DD (inclusive; padrão hoje)."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ from, to }) => json(await getStatsPayload(userId, from ?? null, to ?? null)),
  );

  server.registerTool(
    "get_workout_history",
    {
      title: "Histórico do treino",
      description:
        "Plano atual de uma série de exercícios (kind WORKOUT) e o histórico do que foi realmente executado em cada dia (séries, reps, carga, hora). Padrão: últimos 30 dias.",
      inputSchema: z.object({
        taskId: z.string().describe("Id da tarefa WORKOUT."),
        from: DATE.optional(),
        to: DATE.optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ taskId, from, to }) => {
      const r = await getWorkoutHistory(userId, taskId, from ?? null, to ?? null);
      return r.ok ? json(r.data) : fail(r.message);
    },
  );

  // ---------------- cadastro ----------------

  server.registerTool(
    "create_task",
    {
      title: "Criar tarefa",
      description:
        "Cria uma tarefa recorrente (ou série de exercícios com kind WORKOUT + exercises). WEEKLY exige weekdays; MONTHLY exige monthDay. Sem allowedStates, todos os estados ficam disponíveis.",
      inputSchema: createSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      const r = await createTask(userId, args);
      return r.ok ? json({ created: r.data }) : fail(r.message);
    },
  );

  server.registerTool(
    "update_task",
    {
      title: "Alterar tarefa",
      description:
        "Altera campos de uma tarefa existente (patch: só os campos enviados mudam). Para ajustar uma série, envie exercises com a lista completa — inclua o id dos exercícios mantidos; os omitidos são arquivados (o histórico é preservado). Para só ativar/desativar, envie active.",
      inputSchema: updateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ taskId, ...patch }) => {
      const r = await updateTask(userId, taskId, patch);
      return r.ok ? json({ updated: r.data }) : fail(r.message);
    },
  );

  server.registerTool(
    "delete_task",
    {
      title: "Excluir tarefa",
      description:
        "Exclui a tarefa e todo o seu histórico de marcações (irreversível — prefira update_task com active=false para pausar). Bloqueado se outras tarefas a usam como âncora. Confirme com o usuário antes.",
      inputSchema: z.object({ taskId: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ taskId }) => {
      const r = await deleteTask(userId, taskId);
      return r.ok ? json({ deleted: taskId }) : fail(r.message, r.dependents);
    },
  );

  // ---------------- marcações do dia ----------------

  server.registerTool(
    "set_task_state",
    {
      title: "Marcar tarefa",
      description:
        "Marca o estado de uma tarefa num dia (hoje por padrão; dias passados e futuros permitidos — futuro = adiantar). NONE desmarca. time (HH:mm) registra a hora da execução; sem state, só corrige a hora de um registro existente. Retorna o dia atualizado.",
      inputSchema: z.object({
        taskId: z.string(),
        state: z.enum(["NONE", ...STATE_VALUES]).optional().describe("Novo estado."),
        date: DATE.optional().describe("Dia YYYY-MM-DD (padrão hoje)."),
        time: TIME.optional().describe("Hora real da execução HH:mm (padrão: agora / nominal em dia passado)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ taskId, state, date, time }) => {
      const r = await setCompletion({ userId, taskId, status: state ?? null, time: time ?? null, date: date ?? null });
      return r.ok ? json(await getDayPayload(userId, r.localDate)) : fail(r.message);
    },
  );

  server.registerTool(
    "log_exercise",
    {
      title: "Registrar exercício",
      description:
        "Marca/desmarca um exercício de uma série num dia e/ou ajusta os valores executados (patch parcial). Valores ajustados HOJE também viram o novo plano do exercício. Marcar o último exercício conclui a tarefa automaticamente. Os ids dos exercícios vêm de list_tasks ou get_day.",
      inputSchema: z.object({
        exerciseId: z.string(),
        done: z.boolean().optional().describe("true marca, false desmarca; omitido = mantém."),
        date: DATE.optional().describe("Dia YYYY-MM-DD (padrão hoje)."),
        values: z
          .object({
            sets: exerciseSchema.shape.sets,
            reps: exerciseSchema.shape.reps,
            durationSec: exerciseSchema.shape.durationSec,
            load: exerciseSchema.shape.load,
            loadUnit: exerciseSchema.shape.loadUnit,
          })
          .optional()
          .describe("Valores executados; só as chaves enviadas mudam (null limpa)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ exerciseId, done, date, values }) => {
      // Só as chaves presentes entram no patch (validateValuesPatch usa `key in raw`).
      const patch = values
        ? Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined))
        : null;
      const r = await setExerciseLog({ userId, exerciseId, date: date ?? null, done, values: patch });
      return r.ok ? json(await getDayPayload(userId, r.localDate)) : fail(r.message);
    },
  );

  return server;
}
