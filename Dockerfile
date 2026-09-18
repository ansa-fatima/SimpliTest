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

# Bring the DB in line with prisma/schema.prisma on startup, then start the app.
# schema.prisma is the single source of truth — the entrypoint uses
# `prisma db push` (not migrations), so any table/column/constraint you add to
# the schema is created automatically on the next deploy. See docker-entrypoint.sh.
#
# Env flags:
#   SEED_DATA=true  (default false, non-destructive)
#       After the schema sync, run the idempotent seed (prisma db seed).
#       Safe to leave on: seed.js upserts and skips existing rows. Toggle this
#       true/false to control whether demo data is (re)seeded.
#
#   RESET_DB=true   (default false, DESTRUCTIVE — opt-in only)
#       DROPs the public schema, rebuilds every table from schema.prisma, and
#       re-seeds. Use to recover a corrupted DB, or to clear old leftover
#       columns that block the safe sync. ALL DATA IS LOST — flip back to false
#       after the deploy or every deploy will wipe the database.
#
# The always-on `db push` runs WITHOUT --accept-data-loss, so it can never
# silently drop data; if a schema change would lose data it refuses and logs
# how to proceed. Either way the container always exec's npm start so it stays
# reachable.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
CMD ["/usr/local/bin/docker-entrypoint.sh"]
