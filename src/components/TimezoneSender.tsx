"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Envia o fuso do navegador no 1º carregamento pós-login; o server grava se
 * ainda null (edge 15: sem isso o app usa America/Sao_Paulo com aviso na UI).
 */
export function TimezoneSender() {
  const router = useRouter();
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
          if (data?.updated) router.refresh();
        })
        .catch(() => {});
    } catch {
      // Intl indisponível — server manterá o fuso padrão.
    }
  }, [router]);
  return null;
}
