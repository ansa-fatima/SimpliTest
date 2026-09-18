#!/bin/sh
# Container startup: bring the DB in line with prisma/schema.prisma, optionally
# seed, then start Next.js. See the Dockerfile comment block for the full story.
#
# Three env-controlled stages (all default OFF except the always-on sync):
#   1. Schema sync   — ALWAYS runs (`prisma db push`, non-destructive).
#   2. RESET_DB=true — DESTRUCTIVE opt-in: drop schema, rebuild, force-seed.
#   3. SEED_DATA=true — non-destructive idempotent seed after the sync.
set -u

echo "— DB provisioning —"

if [ "${RESET_DB:-false}" = "true" ]; then
  # ── Stage 2: DESTRUCTIVE reset (opt-in) ─────────────────────────────────────
  # Drops the public schema, then rebuilds every table/column/constraint from
  # schema.prisma. Use this ONCE to recover a corrupted DB, or to clear old
  # leftover columns/tables that block the safe (non-destructive) sync below.
  # ALL DATA IS LOST. Flip RESET_DB back to false after this deploy, or every
  # deploy will wipe the database.
  echo "!! RESET_DB=true — DROPPING the public schema and rebuilding from schema.prisma."
  echo "!! ALL DATA WILL BE LOST. Flip RESET_DB back to false after this deploy."
  if node prisma/reset.js && npx prisma db push --accept-data-loss --skip-generate 2>&1; then
    echo "reset + schema sync OK"
    SEED_DATA=true   # a fresh reset always reseeds so the app isn't empty
  else
    echo "!! reset path failed — starting app anyway, check DATABASE_URL and the logs above"
  fi
else
  # ── Stage 1: Schema sync (ALWAYS, non-destructive) ──────────────────────────
  # `prisma db push` reconciles the live DB to match schema.prisma exactly:
  # it creates missing tables/columns and applies constraints/indexes. This
  # covers the current schema and every FUTURE schema change with no migration
  # files to hand-write. It runs WITHOUT --accept-data-loss, so it can never
  # silently drop a column — a change that would lose data makes it refuse.
  echo "Syncing schema from prisma/schema.prisma (prisma db push)…"
  if npx prisma db push --skip-generate 2>&1; then
    echo "schema sync OK"
  else
    echo "!! schema sync refused or failed."
    echo "!! If the log above says a change would cause data loss (usually an old"
    echo "!! leftover column/table from a removed feature), clear it ONCE with one of:"
    echo "!!   • redeploy with RESET_DB=true          (wipes the DB — opt-in), or"
    echo "!!   • a manual: npx prisma db push --accept-data-loss"
    echo "!! After that, this safe sync runs clean on every deploy."
    echo "!! Starting the app anyway so the container stays reachable."
  fi
fi

# ── Stage 3: Seed (non-destructive, idempotent) ───────────────────────────────
# Controlled by SEED_DATA. seed.js upserts and skips rows that already exist, so
# it is safe to leave on. Runs only after the schema is in sync above.
if [ "${SEED_DATA:-false}" = "true" ]; then
  echo "SEED_DATA=true — running idempotent seed (prisma db seed)…"
  if npx prisma db seed; then
    echo "seed OK"
  else
    echo "!! seed failed — starting app anyway, check the logs above"
  fi
else
  echo "SEED_DATA=false — skipping seed."
fi

echo "— Starting Next.js on PORT=${PORT:-3000} —"
exec npm start
