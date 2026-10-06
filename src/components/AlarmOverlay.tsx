"use client";

import { useEffect, useRef, useState } from "react";

import { notifyDayChanged } from "@/lib/clientEvents";

const SOUND_URL = "/sounds/alarm.wav";

/** Tela cheia de alarme: nome, hora, som em loop, Concluir / Dispensar. */
export function AlarmOverlay({
  taskId,
  name,
  onDismiss,
}: {
  taskId: string;
  name: string;
  onDismiss: () => void;
}) {
  const [clock, setClock] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(SOUND_URL);
    audio.loop = true;
    audioRef.current = audio;
    audio.play().catch(() => {
      // autoplay bloqueado pelo navegador — o som fica dependente de gesto.
    });
    const tick = setInterval(() => setClock(new Date()), 1_000);
    return () => {
      audio.pause();
      audioRef.current = null;
      clearInterval(tick);
    };
  }, []);

  async function complete() {
    setBusy(true);
    try {
      await fetch("/api/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, status: "DONE" }),
      });
      notifyDayChanged();
    } catch {
      // mantém o overlay; o usuário pode tentar de novo
    } finally {
      setBusy(false);
      onDismiss();
    }
  }

  const hhmm = clock.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      role="alert"
      className="fixed inset-0 z-100 flex flex-col items-center justify-center gap-8 bg-indigo-600 px-6 text-white"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-200">Alarme</p>
      <h2 className="max-w-sm text-center text-3xl font-semibold tracking-tight">{name}</h2>
      <p className="text-6xl font-bold tabular-nums">{hhmm}</p>
      <div className="mt-4 flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          onClick={complete}
          disabled={busy}
          className="h-14 rounded-2xl bg-white text-base font-semibold text-indigo-700 transition active:scale-[0.98] disabled:opacity-70"
        >
          {busy ? "Salvando…" : "Concluir"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="h-12 rounded-2xl border border-white/40 text-sm font-medium text-white transition active:scale-[0.98]"
        >
          Dispensar
        </button>
      </div>
    </div>
  );
}
