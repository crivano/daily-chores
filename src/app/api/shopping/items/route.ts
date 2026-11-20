import { auth } from "@/lib/auth";
import { addShoppingItem } from "@/lib/shopping";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const body = ((await req.json().catch(() => ({}))) ?? {}) as {
    placeId?: unknown;
    name?: unknown;
    quantity?: unknown;
  };

  const result = await addShoppingItem(userId, body);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });

  const status = result.data.reactivated || result.data.alreadyPending ? 200 : 201;
  return Response.json(result.data, { status });
}
