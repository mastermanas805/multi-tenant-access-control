# syntax=docker/dockerfile:1

# Multi-stage build for the API Gateway (authN edge) NestJS service.
# Built from the MONOREPO ROOT as the build context so the pnpm workspace
# (root manifest + lockfile + packages/* + apps/gateway) is available:
#   docker build -f apps/gateway/Dockerfile -t gateway .
# docker-compose.yml already sets the context to the repo root.

# ---------- base: pnpm via corepack ----------
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---------- deps: install ALL workspace deps (cached on manifests) ----------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json packages/kernel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/authz/package.json packages/authz/package.json
COPY apps/gateway/package.json apps/gateway/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build: compile kernel + contracts + authz + app ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @kernel/core run build \
 && pnpm --filter @contracts/core run build \
 && pnpm --filter @authz/pep run build \
 && pnpm --filter @app/gateway run build

# ---------- prod-deps: prune to production node_modules ----------
FROM base AS prod-deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json packages/kernel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/authz/package.json packages/authz/package.json
COPY apps/gateway/package.json apps/gateway/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---------- runner: slim runtime image ----------
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Workspace layout so `pnpm --filter` and module resolution work.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/kernel/node_modules ./packages/kernel/node_modules
COPY --from=prod-deps /app/packages/authz/node_modules ./packages/authz/node_modules
COPY --from=prod-deps /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json ./packages/kernel/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/authz/package.json ./packages/authz/package.json
COPY apps/gateway/package.json ./apps/gateway/package.json

# Compiled output.
COPY --from=build /app/packages/kernel/dist ./packages/kernel/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/authz/dist ./packages/authz/dist
COPY --from=build /app/apps/gateway/dist ./apps/gateway/dist

EXPOSE 8080
CMD ["node", "apps/gateway/dist/main.js"]
