import webpush from "web-push";
import { prisma } from "./prisma";

export interface AlarmPushPayload {
  taskId: string;
  title: string;
  body: string;
  tag: string;
}

let vapidReady = false;

function ensureVapid(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_CONTACT_EMAIL ?? "mailto:dev@daily-chores.local",
      publicKey,
      privateKey,
    );
    vapidReady = true;
  }
  return true;
}

export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
}

/** Envia push para TODAS as subscriptions do usuário. 404/410 → remove a subscription. */
export async function sendPushToUser(
  userId: string,
  payload: AlarmPushPayload,
): Promise<{ sent: number; removed: number; skipped: boolean }> {
  if (!ensureVapid()) return { sent: 0, removed: 0, skipped: true };
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          removed += 1;
        } else {
          console.error("[push] falha ao enviar, status:", status ?? err);
        }
      }
    }),
  );
  return { sent, removed, skipped: false };
}
