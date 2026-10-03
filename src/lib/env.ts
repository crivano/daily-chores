/** Helpers de ambiente — sempre lidos em runtime (nunca inlinados no build). */

export function appUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  return url.replace(/\/+$/, "");
}

/** Cloud Tasks configurado (produção). Sem isso usamos a fila local de dev. */
export function cloudTasksConfigured(): boolean {
  return Boolean(process.env.GCP_PROJECT_ID && process.env.GCP_LOCATION);
}
