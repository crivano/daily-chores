/**
 * Auth dos endpoints internos (/api/internal/*):
 * - Produção: OIDC — verifyIdToken(audience = APP_URL) + claim email == alarm-runner@{project}.
 * - Dev: header x-dev-token == DEV_ALARM_TOKEN (sem OIDC).
 */
import { OAuth2Client } from "google-auth-library";
import { appUrl } from "./env";

export async function isAuthorizedInternalRequest(req: Request): Promise<boolean> {
  const devToken = process.env.DEV_ALARM_TOKEN;
  if (devToken && req.headers.get("x-dev-token") === devToken) return true;

  const saEmail = process.env.ALARM_SA_EMAIL;
  const authorization = req.headers.get("authorization");
  if (!saEmail || !authorization?.startsWith("Bearer ")) return false;

  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken: authorization.slice(7),
      audience: process.env.CLOUD_TASKS_AUDIENCE ?? appUrl(),
    });
    const payload = ticket.getPayload();
    return payload?.email === saEmail && (payload.email_verified ?? false) === true;
  } catch {
    return false;
  }
}
