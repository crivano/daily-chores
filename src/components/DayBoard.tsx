"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { AlarmListener } from "./AlarmListener";
import { ProgressRing } from "./ProgressRing";
import { TaskRow } from "./TaskRow";
import { DAY_CHANGED_EVENT } from "@/lib/clientEvents";
import { readDayCache, writeDayCache } from "@/lib/dayCache";
import type { DayPayload, DayTaskDTO } from "@/lib/domain/day";
import { DEFAULT_TZ, addDays, dateInTZ, isValidLocalDate } from "@/lib/domain/schedule";
import { STATE_META, type TaskState } from "@/lib/domain/states";

/** "Hoje" segundo o fuso do navegador — só para achar a chave do cache; o servidor corrige. */
function todayBrowserTz(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return dateInTZ(new Date(), tz || DEFAULT_TZ);
  } catch {
    return dateInTZ(new Date(), DEFAULT_TZ);
  }
}

/** Debounce da persistência de estado por tarefa (ms). */
const STATE_DEBOUNCE_MS = 500;

/** Burst de mudanças de estado de uma tarefa esperando o debounce. */
interface PendingState {
  timer: ReturnType<typeof setTimeout> | null; // null = nada agendado
  inFlight: boolean; // POST do burst em andamento
  status: TaskState; // último estado escolhido (otimista, não confirmado)
  sent: TaskState | null; // último estado gravado no servidor
  date: string; // dia do burst ("YYYY-MM-DD" do primeiro toque)
  baseline: TaskState; // estado pré-burst — alvo do rollback
  resolvers: Array<(ok: boolean) => void>; // um resolvedor por toque já enviado
}

function findTaskRow(day: DayPayload, taskId: string): DayTaskDTO | null {
  return (
    day.tasks.timed.find((t) => t.taskId === taskId) ??
    day.tasks.timeless.find((t) => t.taskId === taskId) ??
    null
  );
}

/** Patch otimista de estado com contadores recalculados (mesma regra do servidor). */
function withTaskState(day: DayPayload, taskId: string, status: TaskState): DayPayload {
  const patch = (t: DayTaskDTO): DayTaskDTO => (t.taskId === taskId ? { ...t, state: status } : t);
  const tasks = {
    timed: day.tasks.timed.map(patch),
    timeless: day.tasks.timeless.map(patch),
  };
  const all = [...tasks.timed, ...tasks.timeless];
  return {
    ...day,
    tasks,
    concluded: all.filter((t) => STATE_META[t.state].conclusive).length,
    cancelled: all.filter((t) => t.state === "CANCELLED").length,
  };
}

/** Repõe otimismo ainda pendente sobre um payload do servidor (mesmo dia). */
function mergePendingStates(day: DayPayload, pending: Map<string, PendingState>): DayPayload {
  let out = day;
  for (const [taskId, p] of pending) {
    if (p.date !== day.date || p.status === p.sent) continue;
    out = withTaskState(out, taskId, p.status);
  }
  return out;
}

/**
 * Painel do dia (client): pinta imediatamente do cache localStorage do dia e
 * revalida com GET /api/day. Mutações são otimistas; mudanças de estado são
 * debounced (STATE_DEBOUNCE_MS por tarefa — toques em sequência viram um único
 * POST com o estado final). A resposta traz o payload completo do dia (shifts
 * em cadeia inclusos).
 */
export function DayBoard({ userId }: { userId: string }) {
  // ?d= resolvido no inicializador (SSR não tem window → hoje). O primeiro
  // render client ainda é esqueleto (day=null), então não há mismatch.
  const [viewD, setViewD] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search).get("d");
    return q && isValidLocalDate(q) ? q : null;
  });
  const [day, setDay] = useState<DayPayload | null>(null);
  const [loadError, setLoadError] = useState(false);

  const viewDRef = useRef<string | null>(null);
  const dayRef = useRef<DayPayload | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef(new Map<string, PendingState>());
  useEffect(() => {
    viewDRef.current = viewD;
  }, [viewD]);

  /** Escreve o dia no estado e sincroniza o ref na hora (sem esperar efeito). */
  function commitDay(next: DayPayload) {
    dayRef.current = next;
    setDay(next);
  }

  /** Payload do servidor na tela, preservando otimismo pendente; cache = verdade. */
  function applyServerDay(fresh: DayPayload) {
    commitDay(mergePendingStates(fresh, pendingRef.current));
    writeDayCache(userId, fresh);
  }

  /**
   * Bomba do debounce de estado: `immediate=false` (re)arma o timer de
   * STATE_DEBOUNCE_MS; `true` (timer disparou) envia o estado pendente.
   * Toques durante o voo rearmam o timer quando a resposta chega — nunca há
   * dois POSTs da mesma tarefa ao mesmo tempo.
   */
  function pumpState(taskId: string, immediate = false) {
    const entry = pendingRef.current.get(taskId);
    if (!entry || entry.inFlight) return;
    if (!immediate) {
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        pumpState(taskId, true);
      }, STATE_DEBOUNCE_MS);
      return;
    }
    if (entry.sent === entry.status) {
      pendingRef.current.delete(taskId);
      return;
    }
    entry.inFlight = true;
    const batch = entry.resolvers;
    entry.resolvers = [];
    const { status, date, baseline } = entry;
    void (async () => {
      let ok = false;
      let day: DayPayload | null = null;
      try {
        const res = await fetch("/api/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, date, status }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; day?: DayPayload }
          | null;
        if (res.ok && json?.day) {
          ok = true;
          day = json.day;
        }
      } catch {
        // offline — mesma tratativa de falha
      }
      entry.inFlight = false;
      if (ok && day) {
        entry.sent = status;
        entry.baseline = findTaskRow(day, taskId)?.state ?? status;
        if (entry.status === status) pendingRef.current.delete(taskId);
        applyServerDay(day);
      } else if (entry.status === status) {
        // Falhou e nada mais novo pendente: rollback apenas do estado da linha.
        const cur = dayRef.current;
        if (cur) commitDay(withTaskState(cur, taskId, baseline));
        pendingRef.current.delete(taskId);
      }
      // Falhou com toque mais novo pendente: mantém o burst para o reenvio.
      batch.forEach((resolve) => resolve(ok));
      if (pendingRef.current.get(taskId) === entry && entry.status !== entry.sent) {
        pumpState(taskId); // re-debounced toques chegados durante o voo
      }
    })();
  }

  // Versão estável para o flush do unmount (pumpState muda a cada render).
  const pumpRef = useRef(pumpState);
  useEffect(() => {
    pumpRef.current = pumpState;
  });

  // Não perde o último toque se desmontar com debounce pendente.
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const [taskId, entry] of pending) {
        if (!entry.inFlight && entry.status !== entry.sent) {
          if (entry.timer !== null) clearTimeout(entry.timer);
          entry.timer = null;
          pumpRef.current(taskId, true);
        }
      }
    };
  }, []);

  /**
   * Busca o payload do dia. `fromCache` pinta o cache imediatamente antes do
   * fetch (troca de data); polling/tick não usa para não regredir o estado vivo.
   */
  const load = useCallback(
    async (target: string | null, opts?: { fromCache?: boolean }) => {
      if (opts?.fromCache) {
        // Sem cache → esqueleto (evita exibir dados de outro dia durante o load).
        const cached = readDayCache(userId, target ?? todayBrowserTz());
        if (cached) commitDay(cached);
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoadError(false);
      try {
        const res = await fetch(`/api/day${target ? `?d=${target}` : ""}`, {
          signal: ac.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const fresh = (await res.json()) as DayPayload;
        if (ac.signal.aborted) return;
        applyServerDay(fresh);
        // Sem ?d o servidor decide "hoje" — adota (lida com virada de dia).
        setViewD(fresh.today ? null : fresh.date);
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || ac.signal.aborted) return;
        setLoadError(true);
      }
    },
    // commitDay/applyServerDay são funções do render que só tocam em refs e
    // setters estáveis — a identidade no cleanup não importa aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId],
  );

  // Montagem e troca de data: cache primeiro (pintura instantânea), rede em
  // seguida. Agendado em timer para sair do corpo síncrono do efeito; o cleanup
  // cancela cargas obsoletas em navegação rápida entre dias.
  useEffect(() => {
    const t = setTimeout(() => load(viewD, { fromCache: true }), 0);
    return () => clearTimeout(t);
  }, [viewD, load]);

  const handleTick = useCallback(() => {
    load(viewDRef.current);
  }, [load]);

  // Polling de 30s apenas no dia de hoje (virada de dia, shifts de cadeia).
  useEffect(() => {
    if (viewD !== null) return;
    const iv = setInterval(handleTick, 30_000);
    return () => clearInterval(iv);
  }, [viewD, handleTick]);

  // Revalida ao voltar para a aba e quando outra ilha muta o dia.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") handleTick();
    };
    window.addEventListener(DAY_CHANGED_EVENT, handleTick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(DAY_CHANGED_EVENT, handleTick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [handleTick]);

  /** Navega ±1 dia; ▶ desabilita em "hoje". URL acompanha sem round-trip.
   *  Só muda o estado — o effect de [viewD] lê o cache e dispara o fetch. */
  function navigate(delta: 1 | -1) {
    const base = viewD ?? day?.date;
    const todayD = day?.todayDate;
    if (!base || !todayD) return;
    const target = addDays(base, delta);
    if (target > todayD) return;
    const isToday = target === todayD;
    setViewD(isToday ? null : target);
    window.history.replaceState(null, "", isToday ? "/" : `/?d=${target}`);
  }

  function goToday() {
    setViewD(null);
    window.history.replaceState(null, "", "/");
  }

  /** Toque no controle de estado: otimista na hora, POST debounced por tarefa. */
  function mutateState(taskId: string, status: TaskState): Promise<boolean> {
    const prev = dayRef.current;
    if (!prev) return Promise.resolve(false);
    commitDay(withTaskState(prev, taskId, status));
    const existing = pendingRef.current.get(taskId);
    const entry: PendingState =
      existing ?? {
        timer: null,
        inFlight: false,
        status,
        sent: null,
        date: prev.date,
        baseline: findTaskRow(prev, taskId)?.state ?? "NONE",
        resolvers: [],
      };
    if (!existing) pendingRef.current.set(taskId, entry);
    entry.status = status;
    const promise = new Promise<boolean>((resolve) => entry.resolvers.push(resolve));
    pumpState(taskId);
    return promise;
  }

  /** Ajuste de hora de conclusão (salvar no editor) — imediato, sem debounce. */
  async function mutateTime(taskId: string, time: string): Promise<boolean> {
    const prev = dayRef.current;
    if (!prev) return false;
    const patch = (t: DayTaskDTO): DayTaskDTO =>
      t.taskId !== taskId
        ? t
        : {
            ...t,
            completedAtLabel: time,
            completedAt: new Date().toISOString(),
          };
    commitDay({
      ...prev,
      tasks: {
        timed: prev.tasks.timed.map(patch),
        timeless: prev.tasks.timeless.map(patch),
      },
    });

    try {
      const res = await fetch("/api/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, date: prev.date, time }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; day?: DayPayload }
        | null;
      if (!res.ok || !json?.day) throw new Error();
      applyServerDay(json.day);
      return true;
    } catch {
      commitDay(prev); // rollback — labels/hora definitivos vêm só do servidor
      return false;
    }
  }

  if (!day) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-zinc-800">
          <p className="text-4xl">⚠️</p>
          <div>
            <p className="font-medium">Não foi possível carregar o dia</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Verifique sua conexão e tente de novo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(viewDRef.current)}
            className="flex h-11 items-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            Tentar de novo
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Carregando o dia">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="h-7 w-56 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-4 w-36 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
          </div>
          <div className="h-16 w-16 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-white shadow-sm dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  const isPast = day.date < day.todayDate;

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Dia anterior"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 active:scale-[0.98] dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <h1 className="min-w-0 flex-1 text-lg font-semibold capitalize leading-tight tracking-tight">
              {day.dateLabel}
            </h1>
            <button
              type="button"
              onClick={() => navigate(1)}
              disabled={!isPast}
              aria-label={isPast ? "Próximo dia" : "Você está no dia de hoje"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:disabled:hover:bg-transparent"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
          {day.tzDefaulted && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Usando o fuso padrão ({DEFAULT_TZ}) — ajuste em Ajustes.
            </p>
          )}
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {day.total === 0
              ? day.today
                ? "Nada previsto para hoje"
                : "Nada previsto neste dia"
              : day.concluded === day.total
                ? "Dia concluído! 🎉"
                : `${day.concluded} de ${day.total} concluídas`}
            {day.cancelled > 0 && ` · ${day.cancelled} cancelada${day.cancelled > 1 ? "s" : ""}`}
          </p>
          {isPast && (
            <button
              type="button"
              onClick={goToday}
              className="mt-2 flex h-7 items-center rounded-full bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition active:scale-[0.98] dark:bg-indigo-500/15 dark:text-indigo-300"
            >
              Voltar para hoje
            </button>
          )}
        </div>
        <ProgressRing done={day.concluded} total={day.total} />
      </header>

      {day.total === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-zinc-800">
          <p className="text-4xl">🌤️</p>
          <div>
            <p className="font-medium">Nenhuma tarefa {day.today ? "para hoje" : "neste dia"}</p>
            {day.today && (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Cadastre uma rotina e ela aparece aqui nos dias certos.
              </p>
            )}
          </div>
          {day.today && (
            <Link
              href="/tarefas"
              className="flex h-11 items-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition active:scale-[0.98]"
            >
              Criar tarefa
            </Link>
          )}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {day.tasks.timed.map((t) => (
              <TaskRow
                key={t.taskId}
                task={t}
                onSetState={(status) => mutateState(t.taskId, status)}
                onSetTime={(time) => mutateTime(t.taskId, time)}
              />
            ))}
          </ul>

          {day.tasks.timeless.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Sem horário
              </h2>
              <ul className="flex flex-col gap-2">
                {day.tasks.timeless.map((t) => (
                  <TaskRow
                    key={t.taskId}
                    task={t}
                    onSetState={(status) => mutateState(t.taskId, status)}
                    onSetTime={(time) => mutateTime(t.taskId, time)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {day.today && <AlarmListener alarms={day.alarms} onTick={handleTick} />}
    </>
  );
}
