#!/bin/sh
# Container startup: sync DB schema, then start Next.js.
# See the Dockerfile comment block for the two paths (SEED_DATA on/off).
set -u

echo "— Schema sync —"

if [ "${SEED_DATA:-false}" = "true" ]; then
  echo "!! SEED_DATA=true — wiping public schema, re-migrating, and re-seeding."
  echo "!! Flip SEED_DATA back to false after this deploy or the next deploy will wipe the DB again."

  if node prisma/reset.js \
     && npx prisma migrate deploy \
     && npx prisma db seed; then
    echo "reset+migrate+seed OK"
  else
    echo "!! reset path failed — starting app anyway, check DATABASE_URL and logs above"
  fi
else
  if npx prisma migrate deploy 2>&1; then
    echo "migrate deploy OK"
  else
    echo "!! migrate deploy failed, falling back to db push"
    if npx prisma db push --skip-generate 2>&1; then
      echo "db push OK"
    else
      echo "!! db push failed too — starting app anyway, check DATABASE_URL"
    fi
  fi
fi

echo "— Starting Next.js on PORT=${PORT:-3000} —"
exec npm start
