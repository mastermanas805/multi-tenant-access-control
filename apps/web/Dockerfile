# syntax=docker/dockerfile:1

# Multi-stage build for the demo SPA: Vite build -> static assets served by nginx.
# Built from the MONOREPO ROOT as the build context so the pnpm workspace
# (root manifest + lockfile + apps/web) is available:
#   docker build -f apps/web/Dockerfile -t web .
# docker-compose.yml already sets the context to the repo root.

# ---------- base: pnpm via corepack ----------
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---------- deps: install the web app's workspace deps (cached on manifests) ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @app/web...

# ---------- build: compile + bundle ----------
FROM deps AS build
# The gateway base URL is baked into the bundle at build time (Vite). It is the
# BROWSER-reachable gateway origin (not a mesh DNS name), so it defaults to the
# host-published edge. Override with --build-arg VITE_GATEWAY_URL=... for a
# different deployment.
ARG VITE_GATEWAY_URL=http://localhost:8080
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
COPY apps/web apps/web
RUN pnpm --filter @app/web run build

# ---------- runner: nginx serving the static build ----------
FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
