"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskDTO } from "@/lib/dto";
import { WEEKDAY_LABELS, gapMinutes } from "@/lib/format";

interface Props {
  task: TaskDTO | null; // null = nova tarefa
  tasks: TaskDTO[];
  onClose: () => void;
}

/** Assinatura de recorrência — âncoras precisam ter a mesma. */
function signatureOf(t: { scheduleType: string; weekdays: number[]; monthDay: number | null }): string {
  if (t.scheduleType === "MONTHLY") return `M:${t.monthDay ?? "?"}`;
  return `W:${[...t.weekdays].sort((a, b) => a - b).join(",")}`;
}

/** true se `candidate` é descendente de `self` (criaria ciclo). */
function isDescendantOf(candidate: TaskDTO, selfId: string | null, byId: Map<string, TaskDTO>): boolean {
  if (!selfId) return false;
  let cur: TaskDTO | undefined = candidate;
  let depth = 0;
  while (cur && depth < 50) {
    if (cur.id === selfId) return true;
    cur = cur.anchorId ? byId.get(cur.anchorId) : undefined;
    depth += 1;
  }
  return false;
}

export function TaskFormModal({ task, tasks, onClose }: Props) {
  const router = useRouter();
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const [name, setName] = useState(task?.name ?? "");
  const [scheduleType, setScheduleType] = useState<"WEEKLY" | "MONTHLY">(task?.scheduleType ?? "WEEKLY");
  const [weekdays, setWeekdays] = useState<number[]>(task?.weekdays ?? [1, 2, 3, 4, 5]);
  const [monthDay, setMonthDay] = useState(task?.monthDay ?? 1);
  const [hasTime, setHasTime] = useState(task ? task.time != null : true);
  const [time, setTime] = useState(task?.time ?? "08:00");
  const [anchorId, setAnchorId] = useState(task?.anchorId ?? "");
  const [offsetMinutes, setOffsetMinutes] = useState(String(task?.offsetMinutes ?? 15));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selfSignature =
    scheduleType === "MONTHLY" ? `M:${monthDay}` : `W:${[...weekdays].sort((a, b) => a - b).join(",")}`;

  // Candidatas a âncora: ativas, mesma recorrência, fora da própria subárvore.
  // Com hora → âncora precisa ter hora; sem hora → qualquer tarefa da cadeia.
  const anchorCandidates = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.active &&
          t.id !== task?.id &&
          !isDescendantOf(t, task?.id ?? null, byId) &&
          signatureOf(t) === selfSignature &&
          (hasTime ? t.time != null : true),
      ),
    [tasks, task, byId, selfSignature, hasTime],
  );

  const selectedAnchor = anchorId ? byId.get(anchorId) : null;
  const gap =
    hasTime && selectedAnchor?.time && time
      ? gapMinutes(time, selectedAnchor.time)
      : null;
  const gapLabel =
    gap == null ? null : gap === 0 ? "mesmo horário" : `${gap > 0 ? "+" : "−"}${Math.abs(gap)} min`;

  function toggleWeekday(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Informe o nome da tarefa.");
    if (scheduleType === "WEEKLY" && weekdays.length === 0) return setError("Selecione pelo menos um dia da semana.");
    if (scheduleType === "MONTHLY" && (monthDay < 1 || monthDay > 31)) return setError("Dia do mês deve estar entre 1 e 31.");
    if (!hasTime && anchorId && (!offsetMinutes || Number(offsetMinutes) < 0)) {
      return setError("Informe o offset em minutos (≥ 0).");
    }

    const payload = {
      name: name.trim(),
      scheduleType,
      ...(scheduleType === "WEEKLY" ? { weekdays: [...weekdays].sort((a, b) => a - b) } : { monthDay }),
      time: hasTime ? time : null,
      anchorTaskId: anchorId || null,
      offsetMinutes: !hasTime && anchorId ? Number(offsetMinutes) : null,
    };

    setSaving(true);
    try {
      const res = await fetch(task ? `/api/tasks/${task.id}` : "/api/tasks", {
        method: task ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Falha ao salvar.");
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  const label = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
  const input =
    "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-800";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-zinc-50 shadow-xl dark:bg-zinc-900 sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="font-semibold">{task ? "Editar tarefa" : "Nova tarefa"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            <div>
              <label htmlFor="task-name" className={label}>Nome</label>
              <input
                id="task-name"
                className={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Tomar café da manhã"
                maxLength={80}
                autoFocus
              />
            </div>

            <div>
              <span className={label}>Repetir</span>
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleType("WEEKLY")}
                  className={`h-9 flex-1 rounded-xl text-xs font-semibold transition ${
                    scheduleType === "WEEKLY"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-zinc-600 shadow-sm dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  Dias da semana
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleType("MONTHLY")}
                  className={`h-9 flex-1 rounded-xl text-xs font-semibold transition ${
                    scheduleType === "MONTHLY"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-zinc-600 shadow-sm dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  Dia do mês
                </button>
              </div>

              {scheduleType === "WEEKLY" ? (
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAY_LABELS.map((dayLabel, index) => {
                    const selected = weekdays.includes(index);
                    return (
                      <button
                        key={dayLabel}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleWeekday(index)}
                        className={`h-11 rounded-xl text-xs font-semibold transition ${
                          selected
                            ? "bg-indigo-600 text-white"
                            : "bg-white text-zinc-600 shadow-sm dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {dayLabel}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className={`${input} w-24`}
                    value={monthDay}
                    onChange={(e) => setMonthDay(Number(e.target.value))}
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Meses sem esse dia simplesmente não executam (ex.: dia 31 em fevereiro).
                  </p>
                </div>
              )}
            </div>

            <div>
              <span className={label}>Horário</span>
              <div className="flex items-center gap-3">
                <input
                  type="time"
                  className={`${input} w-32`}
                  value={hasTime ? time : ""}
                  disabled={!hasTime}
                  onChange={(e) => setTime(e.target.value)}
                />
                <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-indigo-600"
                    checked={!hasTime}
                    onChange={(e) => {
                      setHasTime(!e.target.checked);
                      setAnchorId("");
                    }}
                  />
                  Sem hora fixa
                </label>
              </div>
            </div>

            {hasTime ? (
              <div>
                <label htmlFor="anchor-timed" className={label}>Relativa a (opcional)</label>
                <select
                  id="anchor-timed"
                  className={input}
                  value={anchorId}
                  onChange={(e) => setAnchorId(e.target.value)}
                >
                  <option value="">— nenhuma (horário fixo) —</option>
                  {anchorCandidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.time})
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {selectedAnchor?.time && gapLabel
                    ? `Mantém o gap nominal: ${gapLabel} em relação a ${selectedAnchor.name}. Marcar a âncora atrasada/adiantada desloca esta junto.`
                    : "O intervalo nominal entre as duas é preservado quando a âncora é concluída fora da hora."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <label htmlFor="anchor-timeless" className={label}>Após a tarefa (opcional)</label>
                  <select
                    id="anchor-timeless"
                    className={input}
                    value={anchorId}
                    onChange={(e) => setAnchorId(e.target.value)}
                  >
                    <option value="">— nenhuma (sem alarme) —</option>
                    {anchorCandidates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                {anchorId && (
                  <div>
                    <label htmlFor="offset" className={label}>Minutos após a conclusão</label>
                    <input
                      id="offset"
                      type="number"
                      min={0}
                      className={`${input} w-28`}
                      value={offsetMinutes}
                      onChange={(e) => setOffsetMinutes(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3 border-t border-zinc-200 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-xl border border-zinc-300 text-sm font-medium dark:border-zinc-600"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="h-12 flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
