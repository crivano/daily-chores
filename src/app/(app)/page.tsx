import { redirect } from "next/navigation";

import { DayBoard } from "@/components/DayBoard";
import { auth } from "@/lib/auth";

export const metadata = { title: "Hoje" };

/**
 * Shell fino do "Hoje": os dados do dia vivem no DayBoard (client) com cache
 * localStorage — a página pinta sem esperar o banco.
 */
export default async function HojePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login"); // sessão sem identidade resolvida — refaz login

  return (
    <main>
      <DayBoard userId={userId} />
    </main>
  );
}
