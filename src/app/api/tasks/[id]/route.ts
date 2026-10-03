import { auth } from "@/lib/auth";
import { taskToDTO } from "@/lib/dto";
import { prisma } from "@/lib/prisma";
import { removeAllQueuedForTask, syncAlarms } from "@/lib/sync";
import { validateTaskInput } from "@/lib/tasks";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.userId !== userId) {
    return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) ?? {};
  const result = await validateTaskInput(userId, body, task);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });

  const dependents = await prisma.task.findMany({
    where: { anchorId: id },
    select: { id: true, name: true },
  });
  const updated = await prisma.task.update({ where: { id }, data: result.data });
  await syncAlarms(id).catch((err) => console.error("[sync] pós-update", err));

  return Response.json({ task: taskToDTO(updated, dependents) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.userId !== userId) {
    return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  }

  // Excluir âncora é bloqueado — listar as dependentes para a UI explicar.
  const dependents = await prisma.task.findMany({
    where: { anchorId: id },
    select: { name: true },
  });
  if (dependents.length > 0) {
    return Response.json(
      {
        error: `Não é possível excluir: ${dependents.length} tarefa(s) relativa(s) usam esta como âncora.`,
        dependents: dependents.map((d) => d.name),
      },
      { status: 409 },
    );
  }

  await removeAllQueuedForTask(id);
  await prisma.alarmDelivered.deleteMany({ where: { taskId: id } });
  await prisma.task.delete({ where: { id } }); // completions em cascata

  return new Response(null, { status: 204 });
}
