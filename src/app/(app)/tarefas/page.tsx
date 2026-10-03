import { redirect } from "next/navigation";
import { TasksManager } from "@/components/TasksManager";
import { auth } from "@/lib/auth";
import { buildTaskDTOs } from "@/lib/dto";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Tarefas" };
export const dynamic = "force-dynamic";

export default async function TarefasPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");
  const tasks = await prisma.task.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return <TasksManager tasks={buildTaskDTOs(tasks)} />;
}
