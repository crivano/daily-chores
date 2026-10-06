import { auth } from "@/lib/auth";
import { getStatsPayload } from "@/lib/stats";

/**
 * GET /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD — estatísticas do intervalo
 * (últimos 7 dias terminando hoje, se ausente/inválido). Alimenta o StatsBoard.
 */
export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const stats = await getStatsPayload(userId, sp.get("from"), sp.get("to"));
  return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
}
