/**
 * DTOs do dia — tipos PUROS (sem Prisma), importáveis por client e server.
 * Preenchidos por getDayPayload (src/lib/day.ts) e consumidos pelo DayBoard.
 */
import type { TaskState } from "./states";

/** Linha da lista do dia. */
export interface DayTaskDTO {
  taskId: string;
  name: string;
  state: TaskState; // "NONE" quando sem Completion
  completedAt: string | null; // ISO UTC
  completedAtLabel: string | null; // "HH:mm" no fuso do usuário
  timeLabel?: string; // "HH:mm" do horário efetivo (quando alarma)
  shiftLabel?: string; // "+0:05" / "−1:13"
  note?: string; // "após {âncora}"
}

export interface DayAlarmInfo {
  taskId: string;
  name: string;
  at: number; // epoch ms do horário efetivo
}

export interface DayPayload {
  date: string; // "YYYY-MM-DD" exibido
  todayDate: string; // "YYYY-MM-DD" de hoje no fuso do usuário
  today: boolean; // date === todayDate
  timezone: string;
  tzDefaulted: boolean; // usando DEFAULT_TZ (user.timezone nulo)
  dateLabel: string; // "segunda-feira, 5 de outubro de 2026"
  total: number; // tarefas devidas no dia
  concluded: number; // estados conclusivos
  cancelled: number; // status CANCELLED
  tasks: {
    timed: DayTaskDTO[]; // com hora fixa (ordenadas por horário efetivo)
    timeless: DayTaskDTO[]; // sem hora fixa
  };
  alarms: DayAlarmInfo[]; // apenas quando today (alarmes ainda pendentes)
}
