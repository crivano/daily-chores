"use client";

import { useEffect, useRef, useState } from "react";
import { AlarmOverlay } from "./AlarmOverlay";

export interface AlarmInfo {
  taskId: string;
  name: string;
  at: number; // epoch ms do horário efetivo
}

/**
 * Ilha responsável pelos alarmes na aba em foco:
 * 1. setTimeout para cada alarme pendente de hoje (horário efetivo);
 * 2. mensagens do Service Worker (push recebido com a aba aberta).
 * Sem polling: o payload do dia só é recarregado ao (re)abrir a página, no
 * puxar-para-baixo (DayBoard) e via evento global após mutações.
 */
export function AlarmListener({ alarms }: { alarms: AlarmInfo[] }) {
  const [active, setActive] = useState<{ taskId: string; name: string } | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    const open = (info: { taskId: string; name: string }) => {
      if (activeRef.current) return; // já existe um alarme em exibição
      activeRef.current = true;
      setActive(info);
    };

    const timers: ReturnType<typeof setTimeout>[] = [];
    const now = Date.now();
    for (const alarm of alarms) {
      if (alarm.at <= now) continue;
      const delay = Math.min(alarm.at - now, 2 ** 31 - 1);
      timers.push(setTimeout(() => open(alarm), delay));
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; payload?: { taskId?: string; title?: string; name?: string } }
        | null;
      if (data?.type === "ALARM" && data.payload?.taskId) {
        open({ taskId: data.payload.taskId, name: data.payload.name ?? data.payload.title ?? "Alarme" });
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      timers.forEach(clearTimeout);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [alarms]);

  if (!active) return null;
  return (
    <AlarmOverlay
      taskId={active.taskId}
      name={active.name}
      onDismiss={() => {
        activeRef.current = false;
        setActive(null);
      }}
    />
  );
}
