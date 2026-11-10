-- Séries de exercícios: Task.kind ("SIMPLE" default preserva as tarefas
-- existentes sem backfill) + exercícios por série + registro diário por exercício.
ALTER TABLE "Task" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SIMPLE';

CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sets" INTEGER,
    "reps" INTEGER,
    "durationSec" INTEGER,
    "load" DOUBLE PRECISION,
    "loadUnit" TEXT NOT NULL DEFAULT 'kg',
    "restSec" INTEGER,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExerciseLog" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL,
    "sets" INTEGER,
    "reps" INTEGER,
    "durationSec" INTEGER,
    "load" DOUBLE PRECISION,
    "loadUnit" TEXT NOT NULL DEFAULT 'kg',

    CONSTRAINT "ExerciseLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Exercise_taskId_idx" ON "Exercise"("taskId");
CREATE INDEX "ExerciseLog_taskId_localDate_idx" ON "ExerciseLog"("taskId", "localDate");
CREATE UNIQUE INDEX "ExerciseLog_exerciseId_localDate_key" ON "ExerciseLog"("exerciseId", "localDate");

ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseLog" ADD CONSTRAINT "ExerciseLog_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
