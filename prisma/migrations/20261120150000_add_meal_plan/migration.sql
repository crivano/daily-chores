-- Cardápio estruturado para refeições (Task.kind = "MEAL"):
-- variações, itens com substituições e observações em JSONB.
ALTER TABLE "Task" ADD COLUMN "mealPlan" JSONB;
