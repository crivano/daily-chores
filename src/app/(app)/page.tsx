import Link from "next/link";
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { AlarmListener } from "@/components/AlarmListener";
import { ProgressRing } from "@/components/ProgressRing";
import { TaskCheckbox } from "@/components/TaskCheckbox";
import { auth } from "@/lib/auth";
import {
  DEFAULT_TZ,
  dateInTZ,
  due,
  effectiveAt,
  formatShift,
  shiftOf,
} from "@/lib/domain/schedule";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Hoje" };
export const dynamic = "force-dynamic";

export default async function HojePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login"); // sessão sem identidade resolvida — refaz login

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const tz = user?.timezone ?? DEFAULT_TZ;
  const tzDefaulted = !user?.timezone;

  const now = new Date();
  const todayD = dateInTZ(now, tz);

  const allTasks = await prisma.task.findMany({ where: { userId } });
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const completions = await prisma.completion.findMany({
    where: { userId, localDate: todayD },
  });
  const complByTask = new Map(completions.map((c) => [c.taskId, c]));

  const dueTasks = allTasks.filter((t) => t.active && due(t, todayD));

  const timed = dueTasks
    .filter((t) => t.time)
    .map((t) => ({ task: t, eff: effectiveAt(t, todayD, tz, complByTask, tasksById)! }))
    .sort((a, b) => a.eff.getTime() - b.eff.getTime());

  const timeless = dueTasks
    .filter((t) => !t.time)
    .map((t) => ({ task: t, eff: effectiveAt(t, todayD, tz, complByTask, tasksById) }))
    .sort((a, b) => (a.eff?.getTime() ?? Infinity) - (b.eff?.getTime() ?? Infinity));

  const total = dueTasks.length;
  const done = dueTasks.filter((t) => complByTask.has(t.id)).length;

  // Alarmes pendentes de hoje → o AlarmListener abre o overlay na hora (aba em foco).
  const alarms = dueTasks
    .filter((t) => !complByTask.has(t.id))
    .flatMap((t) => {
      const eff = effectiveAt(t, todayD, tz, complByTask, tasksById);
      return eff && eff.getTime() > now.getTime()
        ? [{ taskId: t.id, name: t.name, at: eff.getTime() }]
        : [];
    });

  const dateLabel = formatInTimeZone(now, tz, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
  const timeOf = (d: Date) => formatInTimeZone(d, tz, "HH:mm");

  return (
    <main>
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold capitalize tracking-tight">{dateLabel}</h1>
          {tzDefaulted && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Usando o fuso padrão ({DEFAULT_TZ}) — ajuste em Ajustes.
            </p>
          )}
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {total === 0
              ? "Nada previsto para hoje"
              : done === total
                ? "Dia concluído! 🎉"
                : `${done} de ${total} concluídas`}
          </p>
        </div>
        <ProgressRing done={done} total={total} />
      </header>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-zinc-800">
          <p className="text-4xl">🌤️</p>
          <div>
            <p className="font-medium">Nenhuma tarefa para hoje</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Cadastre uma rotina e ela aparece aqui nos dias certos.
            </p>
          </div>
          <Link
            href="/tarefas"
            className="flex h-11 items-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            Criar tarefa
          </Link>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {timed.map(({ task, eff }) => {
              const shiftMs = task.anchorId
                ? shiftOf(task, todayD, tz, complByTask, tasksById)
                : 0;
              const completed = complByTask.has(task.id);
              return (
                <TaskCheckbox
                  key={task.id}
                  taskId={task.id}
                  name={task.name}
                  completed={completed}
                  timeLabel={timeOf(eff)}
                  shiftLabel={shiftMs !== 0 ? formatShift(shiftMs) : undefined}
                />
              );
            })}
          </ul>

          {timeless.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Sem horário
              </h2>
              <ul className="flex flex-col gap-2">
                {timeless.map(({ task, eff }) => {
                  const anchor = task.anchorId ? tasksById.get(task.anchorId) : undefined;
                  const anchorDone = task.anchorId ? complByTask.has(task.anchorId) : false;
                  const completed = complByTask.has(task.id);
                  return (
                    <TaskCheckbox
                      key={task.id}
                      taskId={task.id}
                      name={task.name}
                      completed={completed}
                      timeLabel={eff ? timeOf(eff) : undefined}
                      note={anchor && !anchorDone ? `após ${anchor.name}` : undefined}
                    />
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      <AlarmListener alarms={alarms} />
    </main>
  );
}
