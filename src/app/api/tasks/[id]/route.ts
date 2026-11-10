import { auth } from "@/lib/auth";
import { deleteTask, updateTask } from "@/lib/taskService";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) ?? {};
  const result = await updateTask(userId, id, body);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  return Response.json({ task: result.data });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await ctx.params;
  const result = await deleteTask(userId, id);
  if (!result.ok) {
    return Response.json(
      { error: result.message, ...(result.dependents ? { dependents: result.dependents } : {}) },
      { status: result.status },
    );
  }
  return new Response(null, { status: 204 });
}
