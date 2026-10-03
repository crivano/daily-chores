/**
 * Validação e normalização de tarefas (POST/PATCH) — regras da seção 4:
 * - dependente com hora exige âncora COM hora;
 * - offsetMinutes obrigatório se dependente sem hora;
 * - proibir ciclos na cadeia;
 * - âncora deve ter o MESMO scheduleType e o MESMO conjunto de dias (v1),
 *   verificado transitivamente em toda a cadeia.
 */
import type { Task } from "@/generated/prisma/client";
import { prisma } from "./prisma";

export interface TaskInput {
  name?: unknown;
  scheduleType?: unknown;
  weekdays?: unknown;
  monthDay?: unknown;
  time?: unknown;
  anchorTaskId?: unknown;
  offsetMinutes?: unknown;
  active?: unknown;
}

export interface NormalizedTask {
  name: string;
  active: boolean;
  scheduleType: "WEEKLY" | "MONTHLY";
  weekdays: number[];
  monthDay: number | null;
  time: string | null;
  anchorId: string | null;
  offsetMinutes: number | null;
}

export type ValidationResult =
  | { ok: true; data: NormalizedTask }
  | { ok: false; status: number; message: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function bad(status: number, message: string): ValidationResult {
  return { ok: false, status, message };
}

/** Assinatura de recorrência usada para exigir igualdade na cadeia. */
function scheduleSignature(t: { scheduleType: string; weekdays: number[]; monthDay: number | null }): string {
  if (t.scheduleType === "MONTHLY") return `MONTHLY:${t.monthDay ?? "?"}`;
  return `WEEKLY:${[...t.weekdays].sort((a, b) => a - b).join(",")}`;
}

/**
 * Valida `input` como criação (existing = undefined) ou como patch
 * (existing = tarefa atual). Considera toda a cadeia de âncoras/dependentes
 * já existente do usuário.
 */
export async function validateTaskInput(
  userId: string,
  input: TaskInput,
  existing?: Task,
): Promise<ValidationResult> {
  // ---------- campos escalares ----------
  const nameStr = typeof input.name === "string" ? input.name.trim() : undefined;
  const name = nameStr ?? existing?.name;
  if (!name) return bad(400, "Informe o nome da tarefa.");
  if (name.length > 80) return bad(400, "Nome muito longo (máx. 80 caracteres).");

  const active = typeof input.active === "boolean" ? input.active : (existing?.active ?? true);

  const rawType = typeof input.scheduleType === "string" ? input.scheduleType : undefined;
  const scheduleType = (rawType ?? existing?.scheduleType) as "WEEKLY" | "MONTHLY" | undefined;
  if (scheduleType !== "WEEKLY" && scheduleType !== "MONTHLY") {
    return bad(400, "Recorrência inválida (use WEEKLY ou MONTHLY).");
  }

  let weekdays: number[] | undefined;
  if (input.weekdays !== undefined) {
    if (!Array.isArray(input.weekdays)) return bad(400, "weekdays deve ser um array (0=domingo … 6=sábado).");
    const seen = new Set<number>();
    for (const w of input.weekdays) {
      if (typeof w !== "number" || !Number.isInteger(w) || w < 0 || w > 6) {
        return bad(400, "Dias da semana inválidos (0=domingo … 6=sábado).");
      }
      seen.add(w);
    }
    weekdays = [...seen].sort((a, b) => a - b);
  } else if (existing) {
    weekdays = [...existing.weekdays].sort((a, b) => a - b);
  }

  let monthDay: number | null | undefined;
  if (input.monthDay !== undefined && input.monthDay !== null) {
    if (typeof input.monthDay !== "number" || !Number.isInteger(input.monthDay) || input.monthDay < 1 || input.monthDay > 31) {
      return bad(400, "Dia do mês deve estar entre 1 e 31.");
    }
    monthDay = input.monthDay;
  } else if (input.monthDay === null) {
    monthDay = null;
  } else if (existing) {
    monthDay = existing.monthDay;
  }

  if (scheduleType === "WEEKLY") {
    if (!weekdays || weekdays.length === 0) return bad(400, "Selecione pelo menos um dia da semana.");
    monthDay = null;
  } else {
    if (monthDay == null) return bad(400, "Informe o dia do mês (1–31).");
    weekdays = [];
  }

  let time: string | null | undefined;
  if (input.time !== undefined) {
    if (input.time === null || input.time === "") {
      time = null;
    } else if (typeof input.time === "string" && TIME_RE.test(input.time)) {
      time = input.time;
    } else {
      return bad(400, "Horário inválido (use HH:mm).");
    }
  } else if (existing) {
    time = existing.time;
  }

  let anchorId: string | null | undefined;
  if (input.anchorTaskId !== undefined) {
    anchorId = input.anchorTaskId === null || input.anchorTaskId === "" ? null : String(input.anchorTaskId);
  } else if (existing) {
    anchorId = existing.anchorId;
  }

  let offsetMinutes: number | null | undefined;
  if (input.offsetMinutes !== undefined && input.offsetMinutes !== null) {
    if (typeof input.offsetMinutes !== "number" || !Number.isInteger(input.offsetMinutes) || input.offsetMinutes < 0) {
      return bad(400, "Offset em minutos deve ser um inteiro ≥ 0.");
    }
    offsetMinutes = input.offsetMinutes;
  } else if (input.offsetMinutes === null) {
    offsetMinutes = null;
  } else if (existing) {
    offsetMinutes = existing.offsetMinutes;
  }

  // ---------- regras de âncora ----------
  if (anchorId && time == null && offsetMinutes == null) {
    return bad(400, "Tarefa sem hora fixa relativa exige o offset em minutos após a âncora.");
  }
  if (time == null && !anchorId) offsetMinutes = null; // offset só faz sentido com âncora
  if (time != null) offsetMinutes = null; // dependente com hora usa o gap nominal, não offset

  const timeValue = time ?? null;
  const anchorValue = anchorId ?? null;
  const offsetValue = offsetMinutes ?? null;

  // ---------- carga da cadeia ----------
  const allTasks = await prisma.task.findMany({ where: { userId } });
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const merged: TaskLikeRow = {
    id: existing?.id ?? "self",
    anchorId: anchorValue,
    scheduleType,
    weekdays,
    monthDay,
    time: timeValue,
  };
  tasksById.set(merged.id, merged as unknown as Task);

  if (anchorId) {
    const anchor = tasksById.get(anchorId);
    if (!anchor || anchor.id === merged.id) {
      return bad(404, "Tarefa âncora não encontrada.");
    }
    if (time != null && anchor.time == null) {
      return bad(409, "A tarefa âncora precisa ter horário fixo.");
    }
    // Ciclo: subir a cadeia a partir da nova âncora não pode voltar à tarefa.
    let cur: Task | undefined = anchor;
    let depth = 0;
    while (cur && depth < 100) {
      if (cur.id === merged.id) return bad(409, "Cadeia cíclica de tarefas relativas não é permitida.");
      cur = cur.anchorId ? tasksById.get(cur.anchorId) : undefined;
      depth += 1;
    }
  }

  // Igualdade de recorrência em toda a cadeia (âncoras acima + dependentes abaixo).
  const dependentsOf = new Map<string, Task[]>();
  for (const t of allTasks) {
    if (!t.anchorId || t.id === merged.id) continue;
    const list = dependentsOf.get(t.anchorId) ?? [];
    list.push(t);
    dependentsOf.set(t.anchorId, list);
  }

  const selfSig = scheduleSignature(merged);
  const component: Task[] = [];
  const seen = new Set<string>([merged.id]);
  const stack: Task[] = [merged as unknown as Task];
  if (anchorId) {
    let cur = tasksById.get(anchorId);
    let depth = 0;
    while (cur && depth < 100) {
      if (!seen.has(cur.id)) {
        seen.add(cur.id);
        component.push(cur);
        stack.push(cur);
      }
      cur = cur.anchorId ? tasksById.get(cur.anchorId) : undefined;
      depth += 1;
    }
  }
  while (stack.length > 0) {
    const t = stack.pop()!;
    for (const dep of dependentsOf.get(t.id) ?? []) {
      if (!seen.has(dep.id)) {
        seen.add(dep.id);
        component.push(dep);
        stack.push(dep);
      }
    }
  }
  const mismatch = component.find((t) => scheduleSignature(t) !== selfSig);
  if (mismatch) {
    return bad(
      409,
      "A cadeia de tarefas relativas deve ter a mesma recorrência (tipo e dias) em todas as tarefas.",
    );
  }

  return {
    ok: true,
    data: {
      name,
      active,
      scheduleType,
      weekdays,
      monthDay,
      time: timeValue,
      anchorId: anchorValue,
      offsetMinutes: offsetValue,
    },
  };
}

interface TaskLikeRow {
  id: string;
  anchorId: string | null;
  scheduleType: string;
  weekdays: number[];
  monthDay: number | null;
  time: string | null;
}
