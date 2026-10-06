import { auth } from "@/lib/auth";
import { getDayPayload } from "@/lib/day";

/**
 * GET /api/day?d=YYYY-MM-DD — payload do dia (hoje se ausente/inválido/futuro).
 * Alimenta o DayBoard no client (cache localStorage stale-while-revalidate).
 */
export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const d = new URL(req.url).searchParams.get("d");
  const day = await getDayPayload(userId, d);
  return Response.json(day, { headers: { "Cache-Control": "no-store" } });
}
