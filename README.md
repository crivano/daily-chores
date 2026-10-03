# Daily Chores

App web pessoal (pt-BR) para rotinas diárias com alarmes. Tarefas recorrentes por **dias da semana** ou **dia do mês**, cada uma com hora opcional; marcar o checkbox registra o **timestamp real** do clique. Tarefas podem ser **relativas** a outra (âncora): o intervalo nominal entre as duas é preservado — âncora concluída X min após a hora nominal ⇒ dependente alarma X min após a sua.

> A especificação original se referia ao app como “Daily Alarm”; o produto chama-se **Daily Chores** (serviço `daily-chores`).

## Arquitetura (resumo)

- **Next.js 16 (App Router, src/, TS, Tailwind v4)** — UI minimalista, claro/escuro automático, mobile-first, 3 telas: `/` (hoje), `/tarefas`, `/configuracoes`.
- **Domínio puro** em `src/lib/domain/schedule.ts` — única fonte de verdade para `due`, `nominal`, `shiftOf`, `effectiveAt`, `nextOccurrence`. Testado com Vitest (`npm test`).
- **Agendamento dirigido por eventos** via **Cloud Tasks** (fila `alarms`) — sem polling por minuto. `src/lib/sync.ts` mantém, de forma idempotente, o conjunto desejado de alarmes (HOJE + próxima ocorrência) sincronizado com a fila; qualquer mutação de tarefa/completion, cada disparo e um job diário de reconciliação (Cloud Scheduler → `/api/internal/reconcile`) re-sincronizam.
- **Alarmes** via **Web Push (PWA/Serwist)** — app fechado no Android, PWA instalado no iOS 16.4+, desktop com navegador aberto. Com a aba em foco, o alarme toca na própria página (overlay + som em loop).
- **Neon Postgres + Prisma 7** (runtime na string pooled; migrations na direta) · **Auth.js v5 + Google** (sessão JWT) · deploy no **Cloud Run** escalando a zero.

### Política de tarefas relativas

- A dependente alarma no horário **nominal** mesmo se a âncora ainda não foi marcada.
- Âncora marcada **antes** do nominal da dependente ⇒ cancela o nominal e agenda direto no deslocado (adiantamento desloca para mais cedo, simétrico).
- Âncora marcada **depois** e dependente ainda não concluída ⇒ alarma **novamente** no horário deslocado (`kind=SHIFTED`; idempotência por `AlarmDelivered`).
- Sem hora fixa + âncora: alarma N min (`offsetMinutes`) **após a conclusão da âncora**; âncora pendente → fica na seção “Sem horário” com “após {âncora}”.
- Validações: dependente com hora exige âncora com hora; offset obrigatório se sem hora; sem ciclos; âncora com **mesmo scheduleType e dias** (verificado transitivamente).

## Desenvolvimento local

```bash
npm install            # roda prisma generate no postinstall
cp .env.example .env   # preencha AUTH_SECRET, OAuth Google, Neon e VAPID
npm run dev            # http://localhost:3000
```

- **Banco**: crie um projeto no [Neon](https://neon.tech) e cole as duas strings (pooled `-pooler` em `DATABASE_URL`, direta em `DIRECT_URL`). Aplique as migrations com a conexão DIRETA:
  ```bash
  DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
  ```
- **OAuth**: no [Google Console](https://console.cloud.google.com/apis/credentials) crie um OAuth Client (Web) com origens `http://localhost:3000` e a URL de produção; cole ID/secret no `.env`.
- **Push**: `npx web-push generate-vapid-keys` → cole as chaves.
- **Alarmes em dev**: sem `GCP_PROJECT_ID`, o `sync` usa uma **fila local em memória** que dispara `/api/internal/alarm` com `x-dev-token=DEV_ALARM_TOKEN` (timer de 5 s). Para testar o push de verdade: `npm run build && npm start` (o SW só é emitido em build de produção).
- **Testes**: `npm test` (domínio puro — casos canônicos, cadeia A→B→C, DST, dia 31, nomes determinísticos).

## Deploy (gcloud)

```bash
# 0) variáveis
PROJECT=seu-projeto
REGION=us-central1
APP_URL=https://daily-chores-xxxx.run.app   # atualize após o 1º deploy

# 1) Pré-requisito legado das filas HTTP + fila de alarmes
gcloud app create --region=us-central
gcloud tasks queues create alarms --location=$REGION

# 2) Service accounts
gcloud iam service-accounts create run-sa --display-name "Daily Chores runtime"
gcloud iam service-accounts create alarm-runner --display-name "Disparo de alarmes"

# run-sa precisa enfileirar tasks e gerar tokens OIDC como alarm-runner
gcloud projects add-iam-policy-binding $PROJECT \
  --member "serviceAccount:run-sa@$PROJECT.iam.gserviceaccount.com" \
  --role roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding alarm-runner@$PROJECT.iam.gserviceaccount.com \
  --member "serviceAccount:run-sa@$PROJECT.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator
# alarm-runner invoca o serviço
gcloud run services add-iam-policy-binding daily-chores --region=$REGION \
  --member "serviceAccount:alarm-runner@$PROJECT.iam.gserviceaccount.com" \
  --role roles/run.invoker

# 3) Migrations (com a string DIRETA do Neon)
DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" npx prisma migrate deploy

# 4) Secrets (uma vez; ajuste versões ao girar)
for S in AUTH_SECRET AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET DATABASE_URL \
         NEXT_PUBLIC_VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY NEXT_PUBLIC_APP_URL; do
  echo -n "valor de $S: " >&2; gcloud secrets create $S --data-file=-
done

# 5) Deploy
gcloud run deploy daily-chores --source . --region=$REGION \
  --allow-unauthenticated --service-account run-sa@$PROJECT.iam.gserviceaccount.com \
  --set-env-vars GCP_PROJECT_ID=$PROJECT,GCP_LOCATION=$REGION,AUTH_URL=$APP_URL,CLOUD_TASKS_AUDIENCE=$APP_URL,ALARM_SA_EMAIL=alarm-runner@$PROJECT.iam.gserviceaccount.com \
  --set-secrets AUTH_SECRET=AUTH_SECRET:latest,AUTH_GOOGLE_ID=AUTH_GOOGLE_ID:latest,AUTH_GOOGLE_SECRET=AUTH_GOOGLE_SECRET:latest,DATABASE_URL=DATABASE_URL:latest,NEXT_PUBLIC_VAPID_PUBLIC_KEY=NEXT_PUBLIC_VAPID_PUBLIC_KEY:latest,VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest,NEXT_PUBLIC_APP_URL=NEXT_PUBLIC_APP_URL:latest

# 6) Reconciliação diária (06:00 UTC) — OIDC da alarm-runner
gcloud scheduler jobs create http daily-chores-reconcile --location=$REGION \
  --schedule "0 6 * * *" --uri $APP_URL/api/internal/reconcile \
  --http-method POST --oidc-service-account-email alarm-runner@$PROJECT.iam.gserviceaccount.com \
  --oidc-token-audience $APP_URL

# 7) Google Console: adicione $APP_URL às origens autorizadas do OAuth.
```

O Cloud Run acorda só em: mutação do usuário, disparo de alarme e 1 reconcile/dia (custo ~R$ 0 nos free tiers: Run 2 M req/mês, Tasks, Scheduler 3 jobs, Neon 0,5 GB, Secret Manager 6 versões).

## E2E manual (checklist da especificação)

1. Tarefa 2 min no futuro → push chega (com app fechado no Android / aba aberta no desktop).
2. Âncora atrasada (ex.: marcada 10 min depois da hora) → dependente repete deslocada (+10 min).
3. Concluir antes da hora → nada dispara (sync remove as pendências).
4. Reconcile duplicado → nenhum push duplo (`AlarmDelivered` + `ALREADY_EXISTS` tolerado).

## Estrutura

```
src/
├── app/
│   ├── (app)/            # hoje (/), /tarefas, /configuracoes
│   ├── api/              # me, tasks, completions, push, internal/{alarm,reconcile}
│   ├── login/            # botão Google
│   ├── manifest.ts       # PWA manifest
│   └── sw.ts             # Service Worker (Serwist + push)
├── components/           # ilhas client (checkbox, overlay, modal, settings…)
├── lib/
│   ├── domain/schedule.ts(+test)  # funções puras — única fonte de verdade
│   ├── alarms.ts         # Cloud Tasks (+ fila local de dev)
│   ├── sync.ts           # sincronização idempotente dos alarmes
│   ├── tasks.ts          # validações de POST/PATCH (ciclos, cadeia, offset)
│   ├── auth*.ts          # Auth.js v5 (Google, JWT) — config edge + instância
│   └── push.ts           # web-push VAPID (404/410 → remove subscription)
├── proxy.ts              # protege páginas e /api/* (exceto auth/internal)
└── generated/prisma/     # cliente Prisma 7 (gerado)
prisma/                   # schema + migrations
scripts/gen-assets.mjs    # gera ícones PNG + som WAV (sem deps)
```

## Fora do escopo v1

Snooze, histórico/gráficos, fila offline de marcações, recorrência “a cada N dias”, múltiplos fusos por dispositivo, notificações antecipadas.
