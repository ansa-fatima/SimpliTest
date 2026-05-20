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

# Run pending migrations on startup. If they fail (DB asleep, transient error),
# we still start the app so the container is reachable and the App Logs show the error.
# The unhealthy state is preferable to a perpetual NGINX 502.
CMD ["sh", "-c", "echo '— Running prisma migrate deploy —'; npx prisma migrate deploy || echo '!! migrate deploy failed — starting app anyway, fix migrations and redeploy'; echo '— Starting Next.js on PORT='$PORT' —'; exec npm start"]
