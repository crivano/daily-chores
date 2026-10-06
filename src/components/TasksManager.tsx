"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { compareTaskDTOs, type TaskDTO } from "@/lib/dto";
import { recurrenceLabel, timeRuleLabel } from "@/lib/format";
import { TaskFormModal } from "./TaskFormModal";

export function TasksManager({ tasks }: { tasks: TaskDTO[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<TaskDTO | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const active = tasks.filter((t) => t.active).sort(compareTaskDTOs);
  const inactive = tasks.filter((t) => !t.active).sort(compareTaskDTOs);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  async function toggleActive(task: TaskDTO) {
    setBusyId(task.id);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !task.active }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Falha ao salvar.");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(task: TaskDTO) {
    if (task.dependents.length > 0) {
      showToast(`Não é possível excluir: ${task.dependents.map((d) => d.name).join(", ")} é relativa a esta tarefa.`);
      return;
    }
    if (!window.confirm(`Excluir "${task.name}"?`)) return;
    setBusyId(task.id);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error((await res.json().catch(() => ({}))).error ?? "Falha ao excluir.");
      }
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Falha ao excluir.");
    } finally {
      setBusyId(null);
    }
  }

  function renderRow(task: TaskDTO) {
    const anchorName = task.anchorId ? (byId.get(task.anchorId)?.name ?? null) : null;
    return (
      <li
        key={task.id}
        className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-800"
      >
        <div className="min-w-0 flex-1">
          <p className={`truncate font-medium ${task.active ? "" : "text-zinc-400 line-through dark:text-zinc-500"}`}>
            {task.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {recurrenceLabel(task)} · {timeRuleLabel(task, anchorName)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={task.active ? "Desativar" : "Ativar"}
            aria-label={task.active ? "Desativar" : "Ativar"}
            disabled={busyId === task.id}
            onClick={() => toggleActive(task)}
            className={`relative h-7 w-12 rounded-full transition disabled:opacity-50 ${
              task.active ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-600"
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                task.active ? "left-6" : "left-1"
              }`}
            />
          </button>
          <button
            type="button"
            title="Editar"
            aria-label="Editar"
            onClick={() => setEditing(task)}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4.5 w-4.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            type="button"
            title={task.dependents.length > 0 ? "Bloqueado: há tarefas relativas a esta" : "Excluir"}
            aria-label="Excluir"
            disabled={busyId === task.id || task.dependents.length > 0}
            onClick={() => remove(task)}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/10"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4.5 w-4.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </li>
    );
  }

  return (
    <main>
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Tarefas</h1>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="flex h-11 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nova
        </button>
      </header>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-zinc-800">
          <p className="text-4xl">📋</p>
          <p className="font-medium">Nenhuma tarefa cadastrada</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Crie sua primeira rotina — por dias da semana ou dia do mês, com hora e alarme.
          </p>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="mt-2 flex h-11 items-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            Criar tarefa
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Ativas ({active.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {active.length > 0 ? (
                active.map(renderRow)
              ) : (
                <li className="rounded-2xl border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  Nenhuma tarefa ativa.
                </li>
              )}
            </ul>
          </section>
          {inactive.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Inativas ({inactive.length})
              </h2>
              <ul className="flex flex-col gap-2">{inactive.map(renderRow)}</ul>
            </section>
          )}
        </div>
      )}

      {editing && (
        <TaskFormModal
          task={editing === "new" ? null : editing}
          tasks={tasks}
          onClose={() => setEditing(null)}
        />
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[90vw] rounded-full bg-zinc-900 px-4 py-2 text-center text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </div>
      )}
    </main>
  );
}
