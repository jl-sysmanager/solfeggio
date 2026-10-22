# syntax=docker/dockerfile:1.7
# Contexto de build: raíz del monorepo.  docker build -f apps/web/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
# Sin montajes de caché: Railway exige ids con el identificador del servicio.
RUN pnpm install --frozen-lockfile --filter @solfeggio/web...
COPY apps/web apps/web
RUN pnpm --filter @solfeggio/web build

FROM nginx:1.27-alpine AS runtime
ENV PORT=80 \
    API_UPSTREAM=http://api:3000 \
    API_HOST='$host' \
    S3_ORIGIN=http://localhost:9000 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
RUN find /usr/share/nginx/html -name '*.map' -delete
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
