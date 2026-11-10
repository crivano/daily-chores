"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeAssistantAction } from "@/app/(app)/configuracoes/actions";

export interface AiConnectionDTO {
  clientId: string;
  name: string;
  connectedAt: string; // ISO
  lastUsedAt: string | null; // ISO
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Ajustes → Assistentes de IA: URL do servidor MCP para colar no conector
 * (Claude, ChatGPT, Claude Code…) e a lista de assistentes com acesso, com
 * revogação (apaga a concessão OAuth — o assistente terá de autorizar de novo).
 */
export function AiConnections({ mcpUrl, connections }: { mcpUrl: string; connections: AiConnectionDTO[] }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function revoke(clientId: string, name: string) {
    if (!confirm(`Revogar o acesso de "${name}"?`)) return;
    startTransition(async () => {
      await revokeAssistantAction(clientId);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm dark:bg-zinc-800">
      <div>
        <h2 className="font-semibold">Assistentes de IA (MCP)</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Adicione este endereço como conector MCP remoto no seu assistente. Ele pedirá para você entrar e
          autorizar — depois poderá criar e ajustar tarefas, marcar o dia, ver estatísticas e cuidar dos treinos.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-zinc-300 px-3 py-2.5 text-xs dark:border-zinc-600">
          {mcpUrl}
        </code>
        <button
          type="button"
          onClick={copy}
          className="h-10 shrink-0 rounded-xl border border-zinc-300 px-3 text-sm font-medium dark:border-zinc-600"
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>

      {connections.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Nenhum assistente conectado.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-700">
          {connections.map((c) => (
            <li key={c.clientId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Conectado em {dateFmt.format(new Date(c.connectedAt))}
                  {c.lastUsedAt && ` · último uso ${dateFmt.format(new Date(c.lastUsedAt))}`}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => revoke(c.clientId, c.name)}
                className="h-9 shrink-0 rounded-xl border border-red-300 px-3 text-sm font-medium text-red-600 disabled:opacity-60 dark:border-red-800 dark:text-red-400"
              >
                Revogar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
