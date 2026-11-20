import { redirect } from "next/navigation";

import { ShoppingBoard } from "@/components/ShoppingBoard";
import { auth } from "@/lib/auth";

export const metadata = { title: "Compras" };

/**
 * Shell fino da lista de compras: os dados vivem no ShoppingBoard (client)
 * com cache localStorage — a página pinta instantaneamente.
 */
export default async function ComprasPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  return (
    <main>
      <ShoppingBoard userId={userId} />
    </main>
  );
}
