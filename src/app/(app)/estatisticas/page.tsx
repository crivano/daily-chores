import { redirect } from "next/navigation";

import { StatsBoard } from "@/components/StatsBoard";
import { auth } from "@/lib/auth";

export const metadata = { title: "Estatísticas" };
export const dynamic = "force-dynamic";

/**
 * Shell fino das estatísticas: os dados vivem no StatsBoard (client) via
 * GET /api/stats — o intervalo muda sem round-trip de página.
 */
export default async function EstatisticasPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  return (
    <main>
      <StatsBoard />
    </main>
  );
}
