/**
 * Construção do payload de estatísticas (server-only — usa Prisma).
 * Espelha lib/day.ts: tz do usuário (?? DEFAULT_TZ) e consultas paralelas
 * (aproveita o índice @@index([userId, localDate]) de Completion).
 */
import { DEFAULT_TZ, dateInTZ } from "./domain/schedule";
import { buildStatsPayload, clampStatsRange, type StatsPayload } from "./domain/stats";
import { prisma } from "./prisma";

/**
 * Estatísticas de [from, to] ("YYYY-MM-DD"; ausente/inválido/futuro →
 * normalizado para os últimos 7 dias terminando hoje no fuso do usuário).
 */
export async function getStatsPayload(
  userId: string,
  from?: string | null,
  to?: string | null,
): Promise<StatsPayload> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  const todayD = dateInTZ(new Date(), tz);
  const range = clampStatsRange(from, to, todayD);

  const [tasks, completions] = await Promise.all([
    prisma.task.findMany({ where: { userId } }),
    prisma.completion.findMany({
      where: { userId, localDate: { gte: range.from, lte: range.to } },
    }),
  ]);

  return buildStatsPayload(tasks, completions, range.from, range.to, todayD, tz, !user?.timezone);
}
