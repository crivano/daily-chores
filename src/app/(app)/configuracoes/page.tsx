import { redirect } from "next/navigation";
import { AiConnections } from "@/components/AiConnections";
import { SettingsClient } from "@/components/SettingsClient";
import { auth } from "@/lib/auth";
import { DEFAULT_TZ } from "@/lib/domain/schedule";
import { listConnectedClients, mcpResourceUrl } from "@/lib/oauth";
import { vapidPublicKey } from "@/lib/push";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Ajustes" };
export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");
  const [user, connections] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    listConnectedClients(userId),
  ]);
  return (
    <SettingsClient
      email={user?.email ?? session?.user?.email ?? ""}
      timezone={user?.timezone ?? DEFAULT_TZ}
      timezoneDefaulted={!user?.timezone}
      vapidPublicKey={vapidPublicKey()}
      aiSection={
        <AiConnections
          mcpUrl={mcpResourceUrl().toString()}
          connections={connections.map((c) => ({
            clientId: c.clientId,
            name: c.name,
            connectedAt: c.connectedAt.toISOString(),
            lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
          }))}
        />
      }
    />
  );
}
