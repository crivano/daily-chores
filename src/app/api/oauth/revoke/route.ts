import { revokeToken } from "@/lib/oauth";
import { preflight, readFormBody, withCors } from "@/lib/oauth-http";

/** POST — RFC 7009: revoga a concessão do token. Sempre 200 (não revela se existia). */
export async function POST(req: Request) {
  const form = await readFormBody(req);
  if (form.token) await revokeToken(form.token);
  return withCors(new Response(null, { status: 200 }));
}

export const OPTIONS = preflight;
