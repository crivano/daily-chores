import { auth } from "@/lib/auth";
import { getDayPayload } from "@/lib/day";
import { setExerciseLog } from "@/lib/exercises";

/**
 * POST {exerciseId, date?, done?, values?} — marca/desmarca um exercício da
 * série no dia e/ou ajusta seus valores (sets, reps, durationSec, load,
 * loadUnit; patch parcial). Ajustes feitos HOJE passam a valer para os
 * próximos treinos. Marcar o último exercício conclui a tarefa; desmarcar
 * desfaz essa conclusão automática. Responde {ok, day} como /api/completions.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { exerciseId?: unknown; date?: unknown; done?: unknown; values?: unknown }
    | null;
  const exerciseId = typeof body?.exerciseId === "string" ? body.exerciseId : null;
  if (!exerciseId) return Response.json({ error: "exerciseId obrigatório." }, { status: 400 });
  if (body?.done !== undefined && typeof body.done !== "boolean") {
    return Response.json({ error: "done deve ser booleano." }, { status: 400 });
  }
  if (body?.values != null && (typeof body.values !== "object" || Array.isArray(body.values))) {
    return Response.json({ error: "values deve ser um objeto." }, { status: 400 });
  }

  const result = await setExerciseLog({
    userId,
    exerciseId,
    date: typeof body?.date === "string" ? body.date : null,
    done: body?.done as boolean | undefined,
    values: (body?.values as Record<string, unknown> | null | undefined) ?? null,
  });
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });

  const day = await getDayPayload(userId, result.localDate);
  return Response.json({ ok: true, day });
}
