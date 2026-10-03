"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logoutAction } from "@/app/(app)/configuracoes/actions";

const COMMON_TZ = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Cuiaba",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Salvador",
  "America/Rio_Branco",
  "Europe/Lisbon",
  "UTC",
];

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64x = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64x);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return view;
}

interface Props {
  email: string;
  timezone: string;
  timezoneDefaulted: boolean;
  vapidPublicKey: string | null;
}

export function SettingsClient({ email, timezone, timezoneDefaulted, vapidPublicKey }: Props) {
  const router = useRouter();
  const [tz, setTz] = useState(timezone);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | "loading">("loading");
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4500);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Lê estado de sistemas externos (Notification/SW) após o mount.
      const perm: typeof permission =
        typeof Notification !== "undefined" ? Notification.permission : "unsupported";
      let subscribed = false;
      try {
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          subscribed = !!(await reg.pushManager.getSubscription());
        }
      } catch {
        subscribed = false;
      }
      if (!cancelled) {
        setPermission(perm);
        setSubscribed(subscribed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveTz(next: string) {
    setTz(next);
    setBusy(true);
    try {
      const res = await fetch("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: next, force: true }),
      });
      if (!res.ok) throw new Error();
      showToast("Fuso horário atualizado.");
      router.refresh();
    } catch {
      showToast("Não foi possível salvar o fuso.");
    } finally {
      setBusy(false);
    }
  }

  async function enableAlarms() {
    if (!vapidPublicKey) return showToast("Servidor sem chaves VAPID configuradas.");
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
      return showToast("Este navegador não suporta Web Push.");
    }
    setBusy(true);
    try {
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);
      if (permissionResult !== "granted") return showToast("Permissão de notificação negada.");

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error();
      setSubscribed(true);
      showToast("Alarmes ativados neste dispositivo ✅");
    } catch (err) {
      showToast(
        err instanceof Error && err.message
          ? `Falha ao ativar: ${err.message}`
          : "Falha ao ativar alarmes (teste em um build de produção).",
      );
    } finally {
      setBusy(false);
    }
  }

  async function testAlarm() {
    setBusy(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Falha ao enviar.");
      showToast(data.sent ? "Alarme de teste enviado 🔔" : "Nenhum dispositivo inscrito — ative primeiro.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Falha ao enviar teste.");
    } finally {
      setBusy(false);
    }
  }

  const permissionLabel =
    permission === "granted"
      ? "permitida"
      : permission === "denied"
        ? "bloqueada"
        : permission === "unsupported"
          ? "não suportada"
          : "não solicitada";

  const card = "rounded-2xl bg-white p-5 shadow-sm dark:bg-zinc-800";
  const label = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
  const buttonPrimary =
    "h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60";
  const buttonSecondary =
    "h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-600 disabled:opacity-60";

  const tzOptions = [...new Set([tz, ...COMMON_TZ])].sort();

  return (
    <main className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{email}</p>
      </header>

      <section className={card}>
        <label htmlFor="tz" className={label}>Fuso horário</label>
        <select
          id="tz"
          className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          value={tz}
          disabled={busy}
          onChange={(e) => saveTz(e.target.value)}
        >
          {tzOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        {timezoneDefaulted && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Você estava no fuso padrão — confirme ou ajuste acima.
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Datas, virada de dia e alarmes usam este fuso.
        </p>
      </section>

      <section className={`${card} flex flex-col gap-3`}>
        <div>
          <h2 className="font-semibold">Alarmes neste dispositivo</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Notificação: {permissionLabel}
            {subscribed != null && ` · inscrição: ${subscribed ? "ativa" : "nenhuma"}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={buttonPrimary} onClick={enableAlarms} disabled={busy}>
            {subscribed ? "Reativar alarmes" : "Ativar alarmes neste dispositivo"}
          </button>
          <button type="button" className={buttonSecondary} onClick={testAlarm} disabled={busy}>
            Disparar alarme de teste
          </button>
        </div>
        {!vapidPublicKey && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            O servidor está sem chaves VAPID — configure NEXT_PUBLIC_VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY.
          </p>
        )}
      </section>

      <section className={card}>
        <h2 className="font-semibold">Instalar o app (PWA)</h2>
        <div className="mt-3 flex flex-col gap-3 text-sm text-zinc-600 dark:text-zinc-300">
          <div>
            <p className="font-medium">Android / desktop</p>
            <p className="text-zinc-500 dark:text-zinc-400">
              Menu do navegador → <strong>Instalar app</strong> / “Adicionar à tela inicial”. Alarmes chegam via Web Push mesmo com o app fechado.
            </p>
          </div>
          <div>
            <p className="font-medium">iPhone/iPad (iOS 16.4+)</p>
            <p className="text-zinc-500 dark:text-zinc-400">
              Safari → botão Compartilhar → <strong>Adicionar à Tela de Início</strong>. O push só funciona com o PWA instalado (iOS 16.4 ou superior).
            </p>
          </div>
        </div>
      </section>

      <section className={card}>
        <form action={logoutAction}>
          <button type="submit" className={`${buttonSecondary} w-full`}>
            Sair da conta
          </button>
        </form>
      </section>

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[90vw] rounded-full bg-zinc-900 px-4 py-2 text-center text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </div>
      )}
    </main>
  );
}
