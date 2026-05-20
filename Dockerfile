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

# Bring the DB schema up to date on startup. Two paths:
#
# A) SEED_DATA=true (DESTRUCTIVE — opt-in only):
#      Drops the public schema, re-applies all migrations, re-seeds.
#      Use this to recover from a corrupted DB (e.g. missing enum types) or to
#      reset to a known-good demo state. REMEMBER to flip the env back to
#      false after the next deploy, or every deploy will wipe the database.
#
# B) Default (SEED_DATA=false or unset):
#      1) Prefer `prisma migrate deploy` (applies migration files in order).
#      2) If that fails (prod DB has no _prisma_migrations history or was
#         applied against a different instance), fall back to `prisma db push`
#         which syncs columns/tables without touching migration history.
#      3) Either way, exec npm start so the container is always reachable.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
CMD ["/usr/local/bin/docker-entrypoint.sh"]
