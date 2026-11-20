-- Histórico textual de alterações nas sub-atividades (exercícios) de uma série.
-- Não aparece na UI; exposto via MCP em get_workout_history.
CREATE TABLE "ExerciseChange" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "exerciseName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExerciseChange_taskId_createdAt_idx" ON "ExerciseChange"("taskId", "createdAt");

ALTER TABLE "ExerciseChange" ADD CONSTRAINT "ExerciseChange_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseChange" ADD CONSTRAINT "ExerciseChange_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
