import { auth } from "@/lib/auth";
import { HHMM, setCompletion } from "@/lib/completions";
import { isTaskState, type TaskState } from "@/lib/domain/states";
import { getDayPayload } from "@/lib/day";

/**
 * POST {taskId, status?, date?, time?} — grava o estado/hora da tarefa no dia
 * (regras em lib/completions.ts). Responde com o payload do dia atualizado
 * ({ok, day}) — mudanças de shift em cadeia já vêm refletidas.
 * Compat legado: done:true/false → DONE/NONE.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { taskId?: unknown; status?: unknown; time?: unknown; date?: unknown; done?: unknown }
    | null;
  const taskId = typeof body?.taskId === "string" ? body.taskId : null;
  if (!taskId) return Response.json({ error: "taskId obrigatório." }, { status: 400 });

  let status: TaskState | null = null;
  if (isTaskState(body?.status)) status = body.status;
  else if (body?.done === true) status = "DONE";
  else if (body?.done === false) status = "NONE";

  // Hora malformada é ignorada (comportamento histórico da rota).
  const time = typeof body?.time === "string" && HHMM.test(body.time) ? body.time : null;

  const result = await setCompletion({
    userId,
    taskId,
    status,
    time,
    date: typeof body?.date === "string" ? body.date : null,
  });
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });

  const day = await getDayPayload(userId, result.localDate);
  return Response.json({ ok: true, day });
}
