import { auth } from "@/lib/auth";
import { checkAllInPlace, deleteShoppingPlace, updateShoppingPlace } from "@/lib/shopping";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await ctx.params;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as {
    checkAll?: unknown;
    name?: unknown;
    position?: unknown;
  };

  if (body.checkAll === true) {
    const result = await checkAllInPlace(userId, id);
    if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
    return Response.json({ shopping: result.data });
  }

  const result = await updateShoppingPlace(userId, id, body);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  return Response.json(result.data);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await ctx.params;
  const result = await deleteShoppingPlace(userId, id);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  return Response.json({ shopping: result.data });
}
