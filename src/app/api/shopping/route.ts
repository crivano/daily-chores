import { auth } from "@/lib/auth";
import { getShoppingPayload } from "@/lib/shopping";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const shopping = await getShoppingPayload(userId);
  return Response.json(shopping, { headers: { "Cache-Control": "no-store" } });
}
