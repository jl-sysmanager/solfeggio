# syntax=docker/dockerfile:1.7
# Imagen del API y del worker (mismo artefacto, distinto comando). Contexto: raíz del repo.
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
# Sin montajes de caché: Railway exige ids con el identificador del servicio, y la capa del lockfile ya se cachea.
RUN pnpm install --frozen-lockfile --filter @solfeggio/api...
COPY apps/api apps/api
RUN pnpm --filter @solfeggio/api exec prisma generate \
 && pnpm --filter @solfeggio/api build \
 && pnpm --filter @solfeggio/api deploy --prod /out \
 && cp -r apps/api/dist apps/api/prisma /out/ \
 && cd /out && npx prisma generate

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl tini && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=app:app /out ./
COPY --chown=app:app apps/api/scripts/docker-entrypoint.sh ./docker-entrypoint.sh
USER app
EXPOSE 3000
# Docker local y compose usan este healthcheck; Railway ignora HEALTHCHECK y usa la ruta configurada en el servicio.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/v1/health" || exit 1
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
