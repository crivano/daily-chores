<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Daily Chores (repositório `daily-alarm`)

App web pessoal (UI toda em **pt-BR**) para rotinas diárias com alarmes. Tarefas recorrentes por dias da semana ou dia do mês, com hora opcional; marcar o checkbox registra o timestamp real do clique. Tarefas podem ser **relativas** a outra (âncora): o intervalo nominal entre as duas é preservado — âncora concluída X min após a hora nominal ⇒ dependente alarma X min após a sua.

> A especificação original se referia ao app como "Daily Alarm"; o produto chama-se **Daily Chores** (serviço `daily-chores`). Este bloco acima (`nextjs-agent-rules`) é gerado pelo `next dev` — não editar.

## Stack (com as pegadinhas de cada peça)

- **Next.js 16.3.8, App Router, `src/`, TypeScript, Tailwind v4** — build usa **webpack** (`next build --webpack`); 3 telas: `/` (hoje), `/tarefas`, `/configuracoes`, mobile-first, claro/escuro automático.
- **Prisma 7** com driver adapter (`@prisma/adapter-pg`), generator `prisma-client` gerado em **`src/generated/prisma/`** (importar de `@/generated/prisma/client`; este diretório é commitado). Config em **`prisma7.config.ts`** (não é o `schema.prisma` clássico de config). `src/lib/prisma.ts` exporta um **Proxy lazy** — o import nunca constrói o client (o build do Next coleta dados de página sem segredos).
- **Neon Postgres** — runtime usa a string **POOLED** (`DATABASE_URL`, host com `-pooler`); migrations usam a string **DIRETA** (`DIRECT_URL`): `DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy`.
- **Auth.js v5 beta + Google** (sessão JWT). Ver gotcha do `user.id` em "Autenticação".
- **Web Push + PWA/Serwist** — service worker em `src/app/sw.ts` compilado para `public/sw.js` pelo `@serwist/next`. **Serwist fica DESLIGADO em dev** (`disable: NODE_ENV === "development"` no `next.config.ts`) — para testar push de verdade: `npm run build && npm start`.
- **Cloud Tasks** (fila `alarms`) + **Cloud Scheduler** (reconcile diário) + deploy no **Cloud Run** escalando a zero (`output: "standalone"`, Dockerfile multi-stage node:22-alpine). Sem `GCP_PROJECT_ID`/`GCP_LOCATION`, o `lib/alarms.ts` usa uma **fila local em memória** que chama o mesmo endpoint com `x-dev-token`.

## Comandos

```bash
npm install                  # postinstall roda prisma generate
npm run dev                  # dev server (webpack) — SW/push desligados
npm run build && npm start   # build de produção — necessário para testar SW/push
npm test                     # Vitest — domínio puro (src/**/*.test.ts)
npm run lint                 # ESLint
npm run gen:assets           # regenera ícones PNG + som WAV (scripts/gen-assets.mjs, sem deps)
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy   # migrations (string DIRETA)
```

## Variáveis de ambiente (`.env` dev / Secret Manager em produção)

| Var | Uso |
|---|---|
| `AUTH_SECRET` | Auth.js (obrigatório) |
| `AUTH_URL` / `NEXT_PUBLIC_APP_URL` | URL pública da app; usadas por `lib/env.ts` (`appUrl()`) para montar targets do Cloud Tasks e audience OIDC. Lidas **em runtime**, não inlinadas no build. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | OAuth Google (origens autorizadas: localhost + URL do Cloud Run) |
| `DATABASE_URL` | Neon **pooled** (runtime) |
| `DIRECT_URL` | Neon direta (migrations) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push (`npx web-push generate-vapid-keys`). A pública chega ao client via Server Component (`configuracoes/page.tsx` → `vapidPublicKey()`), não via inlining. |
| `VAPID_CONTACT_EMAIL` | Opcional, contato dos servidores de push |
| `GCP_PROJECT_ID` / `GCP_LOCATION` | Presentes ⇒ Cloud Tasks; ausentes ⇒ fila local de dev |
| `ALARM_SA_EMAIL` / `CLOUD_TASKS_AUDIENCE` | OIDC dos tasks (SA `alarm-runner`; audience = APP_URL) |
| `DEV_ALARM_TOKEN` | Aceito por `/api/internal/*` em dev (header `x-dev-token`) |

## Mapa do código

```
src/
├── proxy.ts                     # middleware edge-safe: protege páginas e /api/* (públicos: /login, /api/auth/**, /api/internal/**, /_next, /icons, /sounds, sw.js, manifest)
├── app/
│   ├── (app)/                   # layout autenticado (BottomNav + TimezoneSender + ServiceWorkerRegister)
│   │   ├── page.tsx             # Hoje — shell fino; dados vivem no DayBoard (client)
│   │   ├── tarefas/page.tsx     # CRUD de tarefas (TasksManager)
│   │   ├── estatisticas/page.tsx# StatsBoard (recharts)
│   │   └── configuracoes/       # fuso + push + logout (SettingsClient)
│   ├── api/
│   │   ├── day/                 # GET payload do dia (?d=YYYY-MM-DD)
│   │   ├── tasks/ e tasks/[id]/ # POST/PATCH/DELETE (validação em lib/tasks.ts)
│   │   ├── completions/         # POST estado/hora; responde {ok, day} atualizado
│   │   ├── me/                  # POST fuso (grava se null; force=true sobrescreve + re-sync)
│   │   ├── stats/               # GET estatísticas (?from&to)
│   │   ├── push/subscribe/      # POST upsert de PushSubscription (por endpoint)
│   │   ├── push/test/           # POST dispara push de teste para todas as assinaturas do usuário
│   │   └── internal/alarm|reconcile/  # disparador (Cloud Tasks/fila local) e reconciliação diária — auth OIDC ou x-dev-token
│   ├── manifest.ts / sw.ts / login/ / layout.tsx (fontes Geist, appleWebApp, viewport)
├── components/                  # ilhas client: DayBoard (hoje), TasksManager, TaskFormModal, TaskRow (ciclo de estados), StatsBoard/Stats* , SettingsClient, AlarmListener, AlarmOverlay, BottomNav, TimezoneSender, ServiceWorkerRegister
└── lib/
    ├── domain/schedule.ts       # ★ funções PURAS — ÚNICA fonte de verdade de due/nominal/shiftOf/effectiveAt/nextOccurrence/alarmName
    ├── domain/states.ts         # ★ TaskState + STATE_META (conclusivo x CANCELLED) — isomórfico
    ├── domain/stats.ts / day.ts # tipos/DTOs do payload (pure)
    ├── day.ts                   # getDayPayload — monta o dia (server-only)
    ├── stats.ts                 # getStatsPayload (server-only)
    ├── sync.ts                  # ★ sincronização idempotente dos alarmes (diff desejado x AlarmQueued)
    ├── alarms.ts                # enqueue/delete no Cloud Tasks + fila local de dev
    ├── tasks.ts                 # validação POST/PATCH (âncora, ciclos, recorrência igual na cadeia)
    ├── push.ts                  # VAPID + sendPushToUser (fan-out p/ TODAS as assinaturas; 404/410 remove)
    ├── auth.config.ts           # edge-safe (sem Prisma) — usada pelo proxy
    ├── auth.ts + auth-callbacks.ts # instância completa (Google + callbacks com DB)
    ├── internal-auth.ts         # OIDC verifyIdToken + claim email == ALARM_SA_EMAIL; ou x-dev-token
    ├── prisma.ts                # Proxy lazy (ver acima)
    ├── dto.ts / dayCache.ts / clientEvents.ts / format.ts / env.ts
prisma/schema.prisma + migrations/
```

## Modelo de dados (Prisma)

- `User` (googleSub único, email único, `timezone` IANA nullable — null ⇒ `DEFAULT_TZ = "America/Sao_Paulo"` e UI avisa).
- `Task`: `scheduleType` "WEEKLY" (`weekdays Int[]`, 0=domingo..6) | "MONTHLY" (`monthDay` 1..31); `time "HH:mm"` nullable; cadeia via `anchorId` (+`offsetMinutes`).
- `Completion`: única por `(taskId, localDate)`; `completedAt` = timestamp real (editável); `status` = DONE | CANCELLED | HAPPY | INDIFFERENT | SAD.
- `PushSubscription`: **uma linha por dispositivo** (`endpoint` único); userId + chaves p256dh/auth. **Multi-dispositivo por usuário é suportado** — ver "Notificações".
- `AlarmDelivered`: idempotência do disparo — única por `(taskId, localDate, kind)`, kind = NOMINAL | SHIFTED.
- `AlarmQueued`: espelho do que está no Cloud Tasks (name = `alarm-{taskId}-{localDate}-{epochMs}`).

## Regras de domínio (resumo operacional)

- **Conclusivos** (DONE, HAPPY, INDIFFERENT, SAD): param o alarme, contam no progresso, deslocam cadeias. **CANCELLED**: silencia o alarme mas NÃO conta nem desloca cadeias (dependentes usam o nominal).
- `effectiveAt` (instante UTC do alarme): sem âncora+hora ⇒ nominal; com hora+âncora conclusiva ⇒ nominal + (completedAt(âncora) − nominal(âncora)); com hora+âncora pendente ⇒ nominal + shift herdado (provisório); sem hora+âncora conclusiva ⇒ completedAt(âncora) + offsetMinutes; sem hora+âncora pendente ⇒ não alarma (UI: "após {âncora}").
- Política relativas: dependente alarma no nominal mesmo com âncora pendente; âncora marcada ANTES do nominal da dependente ⇒ cancela o nominal e agenda direto no deslocado; marcada DEPOIS e dependente pendente ⇒ alarma de novo (`kind=SHIFTED`). Tolerância de 30 s (`EARLY_DELIVERY_TOLERANCE_MS`) para não repetir quando o nominal foi entregue adiantado.
- Validações de tarefa (`lib/tasks.ts`): dependente com hora exige âncora COM hora; `offsetMinutes` obrigatório se dependente sem hora; sem ciclos; cadeia inteira com mesmo scheduleType e dias (verificado transitivamente). Excluir âncora com dependentes é bloqueado (409 com nomes).
- Datas são strings "YYYY-MM-DD" no fuso do usuário; toda conversão local↔UTC via `date-fns-tz` (DST-correct). `nextOccurrence` busca até 400 dias (mês sem dia 31 ⇒ não ocorre).
- **Nunca duplique lógica de agendamento/estado em rotas ou componentes — sempre chame `lib/domain/`** (é o contrato testado).

## Alarmes e notificações (como funciona de ponta a ponta)

1. **Disparo é dirigido por eventos, sem polling**: qualquer mutação de tarefa/completion, cada disparo e o reconcile diário chamam `syncAlarms(taskId)` (recursivo na cadeia). O conjunto desejado = alarme de HOJE (se devido, ativo, não concluído, efetivo no futuro) + NOMINAL da próxima ocorrência. O diff com `AlarmQueued` deleta/cria no Cloud Tasks.
2. Cloud Tasks chama `POST /api/internal/alarm` (OIDC da SA `alarm-runner`) → valida (ativa? devida? hoje? concluída?) → grava `AlarmDelivered` (P2002 = já entregue, descarta) → `sendPushToUser` → re-sync.
3. **Há DOIS caminhos de entrega na ponta, e eles são independentes**:
   - **Overlay in-page (NÃO é push)**: `DayBoard` recebe `alarms` (hoje, pendentes, efetivos no futuro) no payload do dia; `AlarmListener` cria `setTimeout` para cada um e abre o `AlarmOverlay` (tela cheia + som em loop + Concluir/Dispensar). Funciona **só com a aba aberta** e **não depende de assinatura push** — ouvir o alarme no browser com a aba aberta NÃO significa que o push está funcionando.
   - **Web Push (app fechado)**: o SW (`sw.ts`) recebe o push; com client visível faz `postMessage` (a página abre o overlay); senão `showNotification` (vibra/som/tag). Requer **opt-in por dispositivo**.
4. **Push é opt-in POR DISPOSITIVO**: Configurações → "Ativar alarmes neste dispositivo" → `pushManager.subscribe` com a VAPID pública → `POST /api/push/subscribe` (upsert por `endpoint`). **Multi-dispositivo é suportado**: N linhas `PushSubscription` por usuário, uma por endpoint; `sendPushToUser` faz fan-out para todas e remove as que devolvem 404/410. iOS 16.4+ exige o PWA instalado (Adicionar à Tela de Início); Android/desktop exigem HTTPS. "Disparar alarme de teste" envia para todas as assinaturas e retorna `{sent}` — `sent: 0` significa que nenhum dispositivo está inscrito.

### Checklist de diagnóstico de push

1. Quantas assinaturas existem? (0 ⇒ nenhum dispositivo ativou; o browser "recebe" via overlay)
   ```sql
   SELECT u.email, split_part(split_part(ps.endpoint,'//',2),'/',1) AS push_service
   FROM "PushSubscription" ps JOIN "User" u ON u.id = ps."userId";
   ```
2. O pipeline disparou? `SELECT count(*) FROM "AlarmDelivered" WHERE "deliveredAt" > now() - interval '7 days';`
3. Testar em build de produção (`npm run build && npm start`) — o SW não existe em dev.

## Autenticação (gotchas)

- `src/proxy.ts` (middleware) usa `authConfig` **edge-safe sem Prisma**; protege tudo exceto os caminhos públicos. As rotas de API validam sessão inline (`auth()` → `session.user.id`).
- **Gotcha Auth.js v5 beta**: o `user.id` dos callbacks NÃO é o googleSub — é um `crypto.randomUUID()`. O googleSub real vem em `profile.sub` / `account.providerAccountId`; o id do banco viaja no JWT como `token.uid` (com auto-recuperação para cookies antigos). Detalhes em `lib/auth-callbacks.ts` (testado em `auth-callbacks.test.ts`).
- Endpoints internos (`/api/internal/*`): produção = OIDC (`verifyIdToken` audience `CLOUD_TASKS_AUDIENCE` + email da SA); dev = header `x-dev-token: $DEV_ALARM_TOKEN`.

## Convenções

- Comentários e UI em pt-BR; comentários explicam "por quê"/restrições, são densos nos arquivos de domínio — manter o estilo.
- Testes (Vitest) cobrem o domínio puro (`domain/*.test.ts`) e os callbacks de auth; rodam sem banco. Ao mudar `domain/schedule.ts` ou `states.ts`, atualize/estenda os casos canônicos (cadeia A→B→C, DST, dia 31).
- Mutations de API respondem 401 sem sessão; erros de validação em pt-BR com status 400/404/409.
- `Cache-Control: no-store` nas APIs de payload (day/stats); DayBoard usa cache localStorage stale-while-revalidate (`lib/dayCache.ts`, chave `dc:day:v1:{userId}`, podado a 30 datas).
- Deploy completo (SAs, filas, secrets, Cloud Scheduler) está no README.md — fonte canônica dos comandos gcloud.

## Histórico de diagnóstico relevante

- **2026-10-07** — "Notificações chegam no browser mas não no telefone": o banco tinha **0 assinaturas push** e 10 `AlarmDelivered` nos últimos 7 dias — ou seja, o pipeline disparava, o push não tinha para quem enviar, e o browser era atendido pelo **overlay in-page** (que não depende de push). Não é bug de "canal único por usuário": o modelo é multi-dispositivo por design; faltava o opt-in por dispositivo (no iOS, com o PWA instalado).
