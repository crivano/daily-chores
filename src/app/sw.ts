/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    ...defaultCache,
    {
      // network-first nas rotas vem do defaultCache; assets estáticos são cache-first.
      matcher: ({ url }) =>
        url.origin === self.location.origin && (url.pathname.startsWith("/sounds/") || url.pathname.startsWith("/icons/")),
      handler: new CacheFirst({
        cacheName: "static-assets",
        plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
  ],
});

/**
 * Push: com client visível (aba em foco) → postMessage (a página abre o
 * overlay e toca o som); senão → showNotification.
 */
self.addEventListener("push", (event) => {
  let payload: { taskId?: string; title?: string; body?: string; tag?: string } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: "Daily Chores" };
  }
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = clients.find((c) => c.visibilityState === "visible");
      if (visible && "postMessage" in visible) {
        visible.postMessage({ type: "ALARM", payload });
        return;
      }
      // vibrate/sound/renotate não estão em todos os lib.d.ts — cast deliberado.
      const options = {
        body: payload.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        vibrate: [400, 200, 400],
        sound: "/sounds/alarm.wav",
        tag: payload.tag,
        renotify: true,
        data: { url: "/" },
      } as NotificationOptions;
      await self.registration.showNotification(payload.title ?? "Daily Chores", options);
    })(),
  );
});

/** notificationclick → foca/abre a raiz. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })(),
  );
});

serwist.addEventListeners();
