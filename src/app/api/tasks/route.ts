import { auth } from "@/lib/auth";
import { taskToDTO } from "@/lib/dto";
import { prisma } from "@/lib/prisma";
import { syncAlarms } from "@/lib/sync";
import { validateTaskInput } from "@/lib/tasks";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) ?? {};
  const result = await validateTaskInput(userId, body);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });

  const task = await prisma.task.create({ data: { userId, ...result.data } });
  await syncAlarms(task.id).catch((err) => console.error("[sync] pós-criação", err));

  return Response.json({ task: taskToDTO(task, []) }, { status: 201 });
}
