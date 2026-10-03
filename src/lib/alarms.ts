/**
 * Enfileiramento de alarmes no Cloud Tasks (fila `alarms`).
 *
 * Produção: HTTP POST para {APP_URL}/api/internal/alarm com OIDC da SA alarm-runner.
 * Dev (sem GCP_PROJECT_ID/GCP_LOCATION): fila em memória + timer local que
 * chama o mesmo endpoint com x-dev-token (DEV_ALARM_TOKEN).
 */
import { CloudTasksClient } from "@google-cloud/tasks";
import type { AlarmKind } from "./domain/schedule";
import { appUrl, cloudTasksConfigured } from "./env";

export interface AlarmJob {
  name: string; // alarm-{taskId}-{localDate}-{epochMs}
  taskId: string;
  localDate: string;
  kind: AlarmKind;
  scheduleTime: Date;
}

const QUEUE_NAME = "alarms";

let client: CloudTasksClient | null = null;
function getClient(): CloudTasksClient {
  client ??= new CloudTasksClient();
  return client;
}

function gcpErrorCode(err: unknown): number | undefined {
  return (err as { code?: number })?.code;
}

// ---------------------------------------------------------------------------
// Fallback local (dev)
// ---------------------------------------------------------------------------

interface LocalAlarm {
  name: string;
  fireAt: number;
  body: string;
}

const localQueue: LocalAlarm[] = [];
let dispatchTimer: ReturnType<typeof setInterval> | null = null;

function ensureLocalDispatcher(): void {
  if (dispatchTimer || typeof setInterval === "undefined") return;
  dispatchTimer = setInterval(() => {
    void dispatchLocal();
  }, 5_000);
  dispatchTimer.unref?.();
}

async function dispatchLocal(): Promise<void> {
  const token = process.env.DEV_ALARM_TOKEN;
  if (!token) return; // sem token: alarmes locais apenas espelhados (teste manual)
  const now = Date.now();
  while (localQueue.length > 0 && localQueue[0].fireAt <= now) {
    const alarm = localQueue.shift()!;
    try {
      await fetch(`${appUrl()}/api/internal/alarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-dev-token": token },
        body: alarm.body,
      });
    } catch (err) {
      console.error("[alarms:dev] falha ao disparar", alarm.name, err);
    }
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Enfileira um alarme. scheduleTime no passado é ajustado para agora (dispara já). */
export async function enqueueAlarm(job: AlarmJob): Promise<void> {
  const when = job.scheduleTime.getTime() > Date.now() ? job.scheduleTime : new Date();
  const body = JSON.stringify({ taskId: job.taskId, localDate: job.localDate, kind: job.kind });

  if (cloudTasksConfigured()) {
    const project = process.env.GCP_PROJECT_ID!;
    const location = process.env.GCP_LOCATION!;
    const parent = getClient().queuePath(project, location, QUEUE_NAME);
    const url = `${appUrl()}/api/internal/alarm`;
    const saEmail = process.env.ALARM_SA_EMAIL;
    try {
      await getClient().createTask({
        parent,
        task: {
          name: `${parent}/tasks/${job.name}`,
          scheduleTime: { seconds: Math.floor(when.getTime() / 1000) },
          httpRequest: {
            httpMethod: "POST",
            url,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(body).toString("base64"),
            ...(saEmail
              ? {
                  oidcToken: {
                    serviceAccountEmail: saEmail,
                    audience: process.env.CLOUD_TASKS_AUDIENCE ?? appUrl(),
                  },
                }
              : {}),
          },
        },
      });
    } catch (err) {
      // Name fica reservado ~1h após execução; recriar com mesmo name é esperado.
      if (gcpErrorCode(err) !== 6) throw err; // 6 = ALREADY_EXISTS
    }
    return;
  }

  localQueue.push({ name: job.name, fireAt: when.getTime(), body });
  localQueue.sort((a, b) => a.fireAt - b.fireAt);
  ensureLocalDispatcher();
}

/** Remove um alarme da fila (Cloud Tasks ou fila local). Tolerante a NOT_FOUND. */
export async function deleteAlarm(name: string): Promise<void> {
  if (cloudTasksConfigured()) {
    const project = process.env.GCP_PROJECT_ID!;
    const location = process.env.GCP_LOCATION!;
    const fullName = getClient().taskPath(project, location, QUEUE_NAME, name);
    try {
      await getClient().deleteTask({ name: fullName });
    } catch (err) {
      if (gcpErrorCode(err) !== 5) throw err; // 5 = NOT_FOUND
    }
    return;
  }
  const idx = localQueue.findIndex((a) => a.name === name);
  if (idx >= 0) localQueue.splice(idx, 1);
}
