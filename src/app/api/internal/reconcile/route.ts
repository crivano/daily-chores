/**
 * Reconciliação diária (Cloud Scheduler → OIDC da alarm-runner).
 * Rede de segurança contra DST, edição de fuso, falhas de enqueue e cadeias
 * quebradas: sincroniza todas as tarefas ativas de todos os usuários.
 */
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { syncAllTasks } from "@/lib/sync";

export async function POST(req: Request) {
  if (!(await isAuthorizedInternalRequest(req))) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await syncAllTasks();
  return Response.json({ ok: true, ...result });
}
