# Daily Chores — Cloud Run (node:22-alpine, multi-stage, output standalone)
FROM node:22-alpine AS base

# ---------- deps ----------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall roda `prisma generate` (precisa do schema)
RUN npm ci

# ---------- builder ----------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* são lidos em runtime via props de Server Components — o build
# não precisa de segredos.
RUN npm run build

# ---------- runner ----------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

RUN addgroup --system nodejs && adduser --system nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
