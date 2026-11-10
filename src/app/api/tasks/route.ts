import { auth } from "@/lib/auth";
import { createTask } from "@/lib/taskService";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) ?? {};
  const result = await createTask(userId, body);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  return Response.json({ task: result.data }, { status: 201 });
}
