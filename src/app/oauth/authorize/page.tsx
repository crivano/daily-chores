import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { decideAction } from "./actions";
import { validateAuthorizeRequest } from "./validate";

export const metadata = { title: "Conectar assistente" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PASS_THROUGH = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
  "resource",
] as const;

/**
 * Tela de consentimento do OAuth do servidor MCP. O login é o Google de
 * sempre (sem sessão → /login?callbackUrl=… e volta para cá).
 */
export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const key of PASS_THROUGH) {
    const v = raw[key];
    params[key] = typeof v === "string" ? v : undefined;
  }

  const session = await auth();
  if (!session?.user?.id) {
    const qs = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined),
    ).toString();
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  const v = await validateAuthorizeRequest(params);
  if (v.kind === "redirect") redirect(v.url);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
        {v.kind === "fatal" ? (
          <>
            <h1 className="text-lg font-semibold">Não foi possível conectar</h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{v.message}</p>
          </>
        ) : (
          <>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
                <circle cx="12" cy="12" r="5" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold leading-snug">
              Conectar <span className="text-indigo-600 dark:text-indigo-400">{v.request.client.name}</span> ao Daily
              Chores?
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Conectado como {session.user.email}. O assistente poderá, em seu nome:
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li>• ver, criar, alterar e excluir tarefas</li>
              <li>• marcar tarefas e exercícios do dia</li>
              <li>• consultar estatísticas e o histórico dos treinos</li>
              <li>• ajustar as séries de exercícios</li>
            </ul>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Você pode revogar o acesso a qualquer momento em Ajustes.
            </p>
            <form action={decideAction} className="mt-6 flex gap-3">
              {Object.entries(params).map(([k, val]) =>
                val === undefined ? null : <input key={k} type="hidden" name={k} value={val} />,
              )}
              <button
                type="submit"
                name="decision"
                value="deny"
                className="h-11 flex-1 rounded-2xl border border-zinc-200 text-sm font-medium dark:border-zinc-600"
              >
                Negar
              </button>
              <button
                type="submit"
                name="decision"
                value="allow"
                className="h-11 flex-1 rounded-2xl bg-indigo-600 text-sm font-medium text-white active:scale-[0.98]"
              >
                Permitir
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
