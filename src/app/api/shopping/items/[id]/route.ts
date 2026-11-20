import { auth } from "@/lib/auth";
import { deleteShoppingItem, updateShoppingItem } from "@/lib/shopping";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await ctx.params;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as {
    name?: unknown;
    quantity?: unknown;
    checked?: unknown;
    placeId?: unknown;
  };

  const result = await updateShoppingItem(userId, id, body);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  return Response.json(result.data);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await ctx.params;
  const result = await deleteShoppingItem(userId, id);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  return Response.json({ shopping: result.data });
}
