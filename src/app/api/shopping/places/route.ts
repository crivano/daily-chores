import { auth } from "@/lib/auth";
import { createShoppingPlace, seedDefaultPlaces } from "@/lib/shopping";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const body = ((await req.json().catch(() => ({}))) ?? {}) as {
    seedDefaults?: unknown;
    name?: unknown;
  };

  if (body.seedDefaults === true) {
    const result = await seedDefaultPlaces(userId);
    if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
    return Response.json({ shopping: result.data }, { status: 201 });
  }

  const result = await createShoppingPlace(userId, body);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  return Response.json(result.data, { status: 201 });
}
