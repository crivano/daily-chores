"use client";

import { useEffect } from "react";

import { notifyDayChanged } from "@/lib/clientEvents";

/**
 * Envia o fuso do navegador no 1º carregamento pós-login; o server grava se
 * ainda null (edge 15: sem isso o app usa America/Sao_Paulo com aviso na UI).
 */
export function TimezoneSender() {
  useEffect(() => {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timezone || sessionStorage.getItem("dc-tz-sent") === "1") return;
      sessionStorage.setItem("dc-tz-sent", "1");
      fetch("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { updated?: boolean } | null) => {
          // Fuso novo pode mudar o "hoje" e todos os horários → recarrega o dia.
          if (data?.updated) notifyDayChanged();
        })
        .catch(() => {});
    } catch {
      // Intl indisponível — server manterá o fuso padrão.
    }
  }, []);
  return null;
}
