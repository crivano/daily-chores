-- Estados marcáveis por tarefa (valores de Completion.status sem "NONE").
-- ARRAY vazio (default) = sem restrição — preserva o comportamento histórico
-- das tarefas existentes sem precisar de backfill.
ALTER TABLE "Task" ADD COLUMN "allowedStates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
