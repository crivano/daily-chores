/**
 * DTOs do dia — tipos PUROS (sem Prisma), importáveis por client e server.
 * Preenchidos por getDayPayload (src/lib/day.ts) e consumidos pelo DayBoard.
 */
import type { TaskState } from "./states";
import type { LoadUnit } from "./workout";

/**
 * Exercício da série no dia. Marcado → valores do SNAPSHOT do registro;
 * pendente → plano atual. Arquivados só aparecem se registrados no dia.
 */
export interface DayExerciseDTO {
  exerciseId: string;
  name: string;
  sets: number | null;
  reps: number | null;
  durationSec: number | null;
  load: number | null;
  loadUnit: LoadUnit;
  restSec: number | null;
  notes: string | null;
  done: boolean;
  doneAtLabel: string | null; // "HH:mm" no fuso do usuário
  archived: boolean;
}

/** Progresso da série no dia (só em tarefas WORKOUT). */
export interface DayWorkoutDTO {
  exercises: DayExerciseDTO[];
  done: number; // exercícios ATIVOS marcados
  total: number; // exercícios ATIVOS
}

/** Linha da lista do dia. */
export interface DayTaskDTO {
  taskId: string;
  name: string;
  state: TaskState; // "NONE" quando sem Completion
  completedAt: string | null; // ISO UTC
  completedAtLabel: string | null; // "HH:mm" no fuso do usuário
  timeLabel?: string; // "HH:mm" do horário previsto/efetivo (quando alarma)
  note?: string; // "após {âncora}"
  allowedStates: TaskState[] | null; // estados marcáveis; null = sem restrição
  workout?: DayWorkoutDTO; // presente só em séries de exercícios
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
    timed: DayTaskDTO[]; // com hora fixa — ordem canônica (hora nominal → nome)
    timeless: DayTaskDTO[]; // sem hora fixa — ordem canônica (A→Z)
  };
}
