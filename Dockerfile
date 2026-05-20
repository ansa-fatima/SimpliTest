# ---------- Builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN mkdir -p public
RUN npm run build

# ---------- Runtime ----------
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

# Bring the DB schema up to date on startup:
#   1) Prefer `prisma migrate deploy` (runs migration files in order, including backfills).
#   2) If that fails (e.g. prod DB has no _prisma_migrations history or is on a different
#      instance than the one dev applied migrations against), fall back to `prisma db push`
#      which brute-force syncs columns/tables without touching migration history.
#   3) Either way, exec npm start so the container is always reachable (no 502).
#      The App Logs will show which path was taken.
CMD ["sh", "-c", "echo '— Schema sync —'; (npx prisma migrate deploy 2>&1 && echo 'migrate deploy OK') || (echo '!! migrate deploy failed, falling back to db push'; npx prisma db push --skip-generate 2>&1 && echo 'db push OK' || echo '!! db push failed too — starting app anyway, check DATABASE_URL'); echo '— Starting Next.js on PORT='$PORT' —'; exec npm start"]
