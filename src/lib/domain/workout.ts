/**
 * Séries de exercícios (Task.kind = "WORKOUT") — funções PURAS, isomórficas.
 *
 * Regras:
 * - um checkbox por exercício (ExerciseLog único por exercício+dia);
 * - o log guarda um SNAPSHOT dos valores do dia; ajustar valores no dia
 *   atualiza também o plano do exercício (vale para os próximos treinos);
 * - marcar o ÚLTIMO exercício ativo conclui a tarefa (estado automático,
 *   completedAt = doneAt do último); desmarcar um exercício de uma série que
 *   estava completa desfaz essa conclusão automática. Estados escolhidos à mão
 *   (humor, BOMB, CANCELLED…) nunca são tocados pela automação.
 * - remover exercício = arquivar (o histórico continua apontando para ele).
 */
import { STATE_META, isStateAllowed, type AllowedStates, type TaskState } from "./states";

export const TASK_KINDS = ["SIMPLE", "WORKOUT"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export function isTaskKind(v: unknown): v is TaskKind {
  return typeof v === "string" && (TASK_KINDS as readonly string[]).includes(v);
}

export const LOAD_UNITS = ["kg", "lb"] as const;
export type LoadUnit = (typeof LOAD_UNITS)[number];

export const MAX_EXERCISES = 50;
export const EXERCISE_NAME_MAX = 80;
export const EXERCISE_NOTES_MAX = 300;

/** Valores numéricos de execução — editáveis no cadastro e no dia. */
export interface ExerciseValues {
  sets: number | null;
  reps: number | null;
  durationSec: number | null;
  load: number | null;
  loadUnit: LoadUnit;
}

/** Exercício normalizado vindo do formulário da tarefa. */
export interface ExerciseInput extends ExerciseValues {
  id: string | null; // null = novo
  name: string;
  restSec: number | null;
  notes: string | null;
}

/** Campos comparáveis de um exercício (plano completo, sem metadados de banco). */
export interface ExerciseSnapshot extends ExerciseValues {
  name: string;
  restSec: number | null;
  notes: string | null;
}

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const LIMITS = {
  sets: { min: 1, max: 99, label: "Séries" },
  reps: { min: 1, max: 999, label: "Repetições" },
  durationSec: { min: 1, max: 36000, label: "Tempo" },
  restSec: { min: 0, max: 3600, label: "Descanso" },
} as const;

const LOAD_MAX = 9999;

/** Inteiro opcional dentro dos limites; ""/null/undefined → null. */
function optInt(v: unknown, key: keyof typeof LIMITS, who: string): Result<number | null> {
  if (v === undefined || v === null || v === "") return { ok: true, data: null };
  const { min, max, label } = LIMITS[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    return { ok: false, message: `${who}: ${label.toLowerCase()} deve ser um inteiro entre ${min} e ${max}.` };
  }
  return { ok: true, data: v };
}

/** Carga opcional ≥ 0, arredondada a 2 casas (evita 22.499999 do float). */
function optLoad(v: unknown, who: string): Result<number | null> {
  if (v === undefined || v === null || v === "") return { ok: true, data: null };
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > LOAD_MAX) {
    return { ok: false, message: `${who}: carga deve ser um número entre 0 e ${LOAD_MAX}.` };
  }
  return { ok: true, data: Math.round(v * 100) / 100 };
}

function unitOf(v: unknown, who: string): Result<LoadUnit> {
  if (v === undefined || v === null || v === "") return { ok: true, data: "kg" };
  if (typeof v === "string" && (LOAD_UNITS as readonly string[]).includes(v)) {
    return { ok: true, data: v as LoadUnit };
  }
  return { ok: false, message: `${who}: unidade de carga inválida (use kg ou lb).` };
}

/**
 * Valida a lista completa de exercícios enviada pelo formulário (a ordem do
 * array é a ordem de exibição). Exige ≥ 1 exercício e nomes únicos não vazios.
 */
export function validateExercises(input: unknown): Result<ExerciseInput[]> {
  if (!Array.isArray(input)) return { ok: false, message: "exercises deve ser um array." };
  if (input.length === 0) return { ok: false, message: "Cadastre pelo menos um exercício na série." };
  if (input.length > MAX_EXERCISES) {
    return { ok: false, message: `Máximo de ${MAX_EXERCISES} exercícios por série.` };
  }
  const out: ExerciseInput[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i] as Record<string, unknown> | null;
    const who = `Exercício ${i + 1}`;
    if (!raw || typeof raw !== "object") return { ok: false, message: `${who}: formato inválido.` };

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return { ok: false, message: `${who}: informe o nome.` };
    if (name.length > EXERCISE_NAME_MAX) {
      return { ok: false, message: `${who}: nome muito longo (máx. ${EXERCISE_NAME_MAX}).` };
    }

    let id: string | null = null;
    if (raw.id !== undefined && raw.id !== null && raw.id !== "") {
      if (typeof raw.id !== "string") return { ok: false, message: `${who}: id inválido.` };
      if (ids.has(raw.id)) return { ok: false, message: `${who}: exercício repetido.` };
      ids.add(raw.id);
      id = raw.id;
    }

    const values = validateExerciseValues(raw, name);
    if (!values.ok) return values;
    const rest = optInt(raw.restSec, "restSec", name);
    if (!rest.ok) return rest;

    let notes: string | null = null;
    if (typeof raw.notes === "string" && raw.notes.trim()) {
      notes = raw.notes.trim();
      if (notes.length > EXERCISE_NOTES_MAX) {
        return { ok: false, message: `${name}: observação muito longa (máx. ${EXERCISE_NOTES_MAX}).` };
      }
    }

    out.push({ id, name, restSec: rest.data, notes, ...values.data });
  }
  return { ok: true, data: out };
}

/** Valida os valores de execução completos (todos os campos; ausente = null). */
export function validateExerciseValues(raw: Record<string, unknown>, who: string): Result<ExerciseValues> {
  const sets = optInt(raw.sets, "sets", who);
  if (!sets.ok) return sets;
  const reps = optInt(raw.reps, "reps", who);
  if (!reps.ok) return reps;
  const durationSec = optInt(raw.durationSec, "durationSec", who);
  if (!durationSec.ok) return durationSec;
  const load = optLoad(raw.load, who);
  if (!load.ok) return load;
  const loadUnit = unitOf(raw.loadUnit, who);
  if (!loadUnit.ok) return loadUnit;
  return {
    ok: true,
    data: {
      sets: sets.data,
      reps: reps.data,
      durationSec: durationSec.data,
      load: load.data,
      loadUnit: loadUnit.data,
    },
  };
}

/**
 * Patch PARCIAL de valores (ajuste no dia): só as chaves presentes entram;
 * null/"" limpa o campo. Retorna `{}` se nenhuma chave de valor veio.
 */
export function validateValuesPatch(raw: Record<string, unknown>, who: string): Result<Partial<ExerciseValues>> {
  const full = validateExerciseValues(raw, who);
  if (!full.ok) return full;
  const patch: Partial<ExerciseValues> = {};
  for (const key of ["sets", "reps", "durationSec", "load", "loadUnit"] as const) {
    if (key in raw) (patch as Record<string, unknown>)[key] = full.data[key];
  }
  return { ok: true, data: patch };
}

/** true se o patch muda algum valor em relação ao atual. */
export function valuesDiffer(current: ExerciseValues, patch: Partial<ExerciseValues>): boolean {
  return (Object.keys(patch) as (keyof ExerciseValues)[]).some((k) => patch[k] !== current[k]);
}

/** Formata segundos como "45s", "1min", "1min30s". */
export function formatSeconds(total: number): string {
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m}min${String(s).padStart(2, "0")}s` : `${m}min`;
}

/** Carga sem zeros supérfluos e com vírgula decimal: 22.5 → "22,5 kg". */
export function formatLoad(load: number, unit: string): string {
  return `${String(load).replace(".", ",")} ${unit}`;
}

/** Resumo de uma linha: "3×10 · 20 kg", "3×45s", "12 reps", "Descanso 60s" fica de fora. */
export function exerciseSummary(v: ExerciseValues): string {
  const parts: string[] = [];
  const unit = v.reps != null ? String(v.reps) : v.durationSec != null ? formatSeconds(v.durationSec) : null;
  if (v.sets != null && unit) parts.push(`${v.sets}×${unit}`);
  else if (v.sets != null) parts.push(`${v.sets} ${v.sets === 1 ? "série" : "séries"}`);
  else if (v.reps != null) parts.push(`${v.reps} reps`);
  else if (unit) parts.push(unit);
  if (v.load != null) parts.push(formatLoad(v.load, v.loadUnit));
  return parts.join(" · ");
}

/**
 * Estado aplicado automaticamente quando todos os exercícios são marcados:
 * DONE se permitido; senão o primeiro estado conclusivo permitido; senão null
 * (tarefa não aceita conclusão automática — o usuário marca à mão).
 */
export function autoCompleteState(allowed: AllowedStates): TaskState | null {
  if (isStateAllowed(allowed, "DONE")) return "DONE";
  return allowed?.find((s) => STATE_META[s].conclusive) ?? null;
}

export type CompletionAction =
  | { kind: "none" }
  | { kind: "upsert"; status: TaskState; completedAt: Date }
  | { kind: "delete" };

/**
 * Efeito de uma marcação de exercício sobre a Completion da série.
 * - `wasAllDone`/`isAllDone`: todos os exercícios ATIVOS marcados, antes/depois;
 * - `current`: status da Completion do dia (null = sem registro);
 * - `lastDoneAt`: maior doneAt entre os logs do dia (após a ação).
 *
 * Só o estado automático é gerenciado: completar sem registro cria; completar
 * com o automático já gravado atualiza a hora; desfazer (estava completo e não
 * está mais) remove o automático. Qualquer outro status é escolha do usuário.
 */
export function workoutCompletionAction(args: {
  wasAllDone: boolean;
  isAllDone: boolean;
  current: TaskState | null;
  autoState: TaskState | null;
  lastDoneAt: Date | null;
}): CompletionAction {
  const { wasAllDone, isAllDone, current, autoState, lastDoneAt } = args;
  if (!autoState) return { kind: "none" };
  if (isAllDone && lastDoneAt) {
    if (current === null || current === "NONE" || current === autoState) {
      return { kind: "upsert", status: autoState, completedAt: lastDoneAt };
    }
    return { kind: "none" };
  }
  if (wasAllDone && !isAllDone && current === autoState) return { kind: "delete" };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Histórico textual de alterações em exercícios (consumido pelo MCP)
// ---------------------------------------------------------------------------

const EMPTY_VAL = "—";

function fmtInt(v: number | null): string {
  return v == null ? EMPTY_VAL : String(v);
}

function fmtSec(v: number | null): string {
  return v == null ? EMPTY_VAL : formatSeconds(v);
}

function fmtLoad(load: number | null, unit: LoadUnit): string {
  return load == null ? EMPTY_VAL : formatLoad(load, unit);
}

function fmtText(v: string | null): string {
  return v == null ? EMPTY_VAL : `"${v}"`;
}

/**
 * Lista de diferenças legíveis entre dois conjuntos de valores de execução
 * (séries, repetições, tempo, carga/unidade). Mudar só `loadUnit` quando ambas
 * as cargas são nulas é ignorado (não houve mudança efetiva de carga).
 */
export function describeExerciseValuesDiff(prev: ExerciseValues, next: ExerciseValues): string[] {
  const diffs: string[] = [];
  if (prev.sets !== next.sets) diffs.push(`séries: ${fmtInt(prev.sets)} → ${fmtInt(next.sets)}`);
  if (prev.reps !== next.reps) diffs.push(`repetições: ${fmtInt(prev.reps)} → ${fmtInt(next.reps)}`);
  if (prev.durationSec !== next.durationSec) {
    diffs.push(`tempo: ${fmtSec(prev.durationSec)} → ${fmtSec(next.durationSec)}`);
  }
  const hasLoad = prev.load != null || next.load != null;
  if (hasLoad && (prev.load !== next.load || prev.loadUnit !== next.loadUnit)) {
    diffs.push(`carga: ${fmtLoad(prev.load, prev.loadUnit)} → ${fmtLoad(next.load, next.loadUnit)}`);
  }
  return diffs;
}

/** Diferenças legíveis de todos os campos editáveis de um exercício no cadastro. */
export function describeExerciseDiff(prev: ExerciseSnapshot, next: ExerciseSnapshot): string[] {
  const diffs: string[] = [];
  if (prev.name !== next.name) diffs.push(`nome: ${fmtText(prev.name)} → ${fmtText(next.name)}`);
  diffs.push(...describeExerciseValuesDiff(prev, next));
  if (prev.restSec !== next.restSec) diffs.push(`descanso: ${fmtSec(prev.restSec)} → ${fmtSec(next.restSec)}`);
  if (prev.notes !== next.notes) diffs.push(`observação: ${fmtText(prev.notes)} → ${fmtText(next.notes)}`);
  return diffs;
}

/** Descrição textual de um exercício recém-adicionado a uma série existente. */
export function describeExerciseAdded(ex: ExerciseSnapshot): string {
  const details = [
    exerciseSummary(ex) || null,
    ex.restSec != null ? `descanso ${formatSeconds(ex.restSec)}` : null,
    ex.notes ? `obs.: ${ex.notes}` : null,
  ].filter(Boolean);
  return details.length > 0 ? `Adicionado à série (${details.join("; ")})` : "Adicionado à série";
}

/** Descrição textual de um exercício removido (arquivado) de uma série. */
export function describeExerciseRemoved(): string {
  return "Removido da série";
}

/** Descrição textual de uma edição feita no cadastro da tarefa. */
export function describePlanEdit(diffs: string[]): string {
  return `Editado no cadastro: ${diffs.join("; ")}`;
}

/** Descrição textual de um ajuste feito durante o dia (hoje atualiza o plano). */
export function describeDayValueAdjustment(diffs: string[], localDate: string, updatedPlan: boolean): string {
  const prefix = updatedPlan
    ? `Ajuste no treino de ${localDate} (plano atualizado)`
    : `Ajuste no registro de ${localDate} (apenas neste dia)`;
  return `${prefix}: ${diffs.join("; ")}`;
}

/**
 * true se os exercícios MANTIDOS (presentes em `prevIds` e `nextIds`) mudaram
 * de ordem relativa. Inserções ou remoções que apenas deslocam índices não
 * contam como reordenação.
 */
export function exerciseOrderChanged(prevIds: string[], nextIds: string[]): boolean {
  const nextSet = new Set(nextIds);
  const prevKept = prevIds.filter((id) => nextSet.has(id));
  const prevSet = new Set(prevIds);
  const nextKept = nextIds.filter((id) => prevSet.has(id));
  if (prevKept.length !== nextKept.length) return false;
  return prevKept.some((id, i) => id !== nextKept[i]);
}
