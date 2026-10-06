"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_TZ, addDays, dateInTZ } from "@/lib/domain/schedule";
import { conclusivesOf, formatLocalDate, markedOf, type StatsPayload } from "@/lib/domain/stats";
import { StatsDonut } from "./StatsDonut";
import { StatsRangePicker, type StatsMode } from "./StatsRangePicker";
import { StatsTimeline } from "./StatsTimeline";
import { TaskStatBars } from "./TaskStatBars";

/** "Hoje" segundo o fuso do navegador — só para o intervalo inicial; o servidor corrige/clampa. */
function browserToday(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;
    return dateInTZ(new Date(), tz);
  } catch {
    return dateInTZ(new Date(), DEFAULT_TZ);
  }
}

/**
 * Painel de estatísticas (client): busca GET /api/stats ao montar e a cada
 * troca de intervalo (Semana/Mês/Datas). Sem cache — dados agregados são
 * baratos e sempre frescos.
 */
export function StatsBoard() {
  const [mode, setMode] = useState<StatsMode>("week");
  // Inicial no navegador (default = últimos 7 dias); o primeiro payload do
  // servidor traz o "hoje" do fuso do usuário, âncora dos próximos atalhos.
  const [range, setRange] = useState(() => {
    const today = browserToday();
    return { from: addDays(today, -6), to: today };
  });
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  // "Hoje" segundo o servidor (fuso do usuário) — âncora dos atalhos.
  const [today, setToday] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (from: string, to: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(false);
    setRefreshing(true);
    try {
      const res = await fetch(`/api/stats?from=${from}&to=${to}`, {
        signal: ac.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as StatsPayload;
      if (ac.signal.aborted) return;
      setToday(fresh.today);
      setStats(fresh);
    } catch (err) {
      if ((err as Error)?.name === "AbortError" || ac.signal.aborted) return;
      setError(true);
    } finally {
      if (!ac.signal.aborted) setRefreshing(false);
    }
  }, []);

  // Montagem e troca de intervalo. Agendado em timer para sair do corpo
  // síncrono do efeito (mesmo padrão do DayBoard); o cleanup cancela cargas
  // obsoletas em trocas rápidas de intervalo.
  useEffect(() => {
    const t = setTimeout(() => void load(range.from, range.to), 0);
    return () => clearTimeout(t);
  }, [range, load]);

  /** Atalhos relativos ao "hoje" do servidor (fuso do usuário). */
  function shortcut(next: "week" | "month") {
    const anchor = today ?? range.to;
    setMode(next);
    setRange(
      next === "week"
        ? { from: addDays(anchor, -6), to: anchor }
        : { from: addDays(anchor, -29), to: anchor },
    );
  }

  function openCustom() {
    setMode("custom"); // só abre o editor; o fetch acontece no Aplicar
  }

  function applyCustom(from: string, to: string) {
    setRange({ from, to });
  }

  if (!stats) {
    if (error) {
      return (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-zinc-800">
          <p className="text-4xl">⚠️</p>
          <div>
            <p className="font-medium">Não foi possível carregar as estatísticas</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Verifique sua conexão e tente de novo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(range.from, range.to)}
            className="flex h-11 items-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            Tentar de novo
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando estatísticas">
        <div className="space-y-2">
          <div className="h-7 w-40 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-56 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
        </div>
        <div className="h-11 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-700" />
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-64 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
      </div>
    );
  }

  const marked = markedOf(stats.totals);
  const concluded = conclusivesOf(stats.totals);
  const cancelled = stats.totals.CANCELLED;
  const ratePct = Math.round(stats.conclusionRate * 100);
  const empty = marked === 0 && stats.totalDue === 0;

  return (
    <div className="transition-opacity duration-150 data-[refreshing=true]:opacity-50" data-refreshing={refreshing}>
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">Estatísticas</h1>
        <p className="mt-0.5 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
          {formatLocalDate(stats.from, "d MMM")} – {formatLocalDate(stats.to, "d MMM")} ·{" "}
          {stats.days} {stats.days === 1 ? "dia" : "dias"}
        </p>
        {stats.tzDefaulted && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Usando o fuso padrão ({DEFAULT_TZ}) — ajuste em Ajustes.
          </p>
        )}
      </header>

      <StatsRangePicker
        mode={mode}
        from={range.from}
        to={range.to}
        today={today ?? range.to}
        onShortcut={shortcut}
        onOpenCustom={openCustom}
        onCustom={applyCustom}
      />

      {error && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          <span>Falha ao atualizar — mostrando o período anterior.</span>
          <button
            type="button"
            onClick={() => void load(range.from, range.to)}
            className="shrink-0 font-semibold underline underline-offset-2"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {empty ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-zinc-800">
          <p className="text-4xl">📊</p>
          <div>
            <p className="font-medium">Nenhuma marcação neste intervalo</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Amplie o período ou registre tarefas no dia a dia.
            </p>
          </div>
        </div>
      ) : (
        <>
          <section className="mt-4 grid grid-cols-4 gap-2" aria-label="Resumo do período">
            <div className="rounded-2xl bg-white p-3 text-center shadow-sm dark:bg-zinc-800">
              <p className="text-xl font-semibold tabular-nums">{marked}</p>
              <p className="mt-0.5 text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">marcações</p>
            </div>
            <div className="rounded-2xl bg-white p-3 text-center shadow-sm dark:bg-zinc-800">
              <p className="text-xl font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                {concluded}
              </p>
              <p className="mt-0.5 text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">concluídas</p>
            </div>
            <div className="rounded-2xl bg-white p-3 text-center shadow-sm dark:bg-zinc-800">
              <p className="text-xl font-semibold text-zinc-400 tabular-nums dark:text-zinc-500">
                {cancelled}
              </p>
              <p className="mt-0.5 text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">canceladas</p>
            </div>
            <div className="rounded-2xl bg-white p-3 text-center shadow-sm dark:bg-zinc-800">
              <p className="text-xl font-semibold tabular-nums">{ratePct}%</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full rounded-full bg-indigo-600 dark:bg-indigo-500"
                  style={{ width: `${ratePct}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">taxa</p>
            </div>
          </section>

          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-800">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Marcações por status
            </h2>
            <StatsDonut totals={stats.totals} marked={marked} />
          </section>

          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-800">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Andamento
            </h2>
            <StatsTimeline buckets={stats.buckets} />
          </section>

          <section className="mt-6">
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Por tarefa
            </h2>
            <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-800">
              <TaskStatBars tasks={stats.tasks} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
