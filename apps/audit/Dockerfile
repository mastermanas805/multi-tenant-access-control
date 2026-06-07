# syntax=docker/dockerfile:1

# Multi-stage build for the Audit (hash-chained log) NestJS service.
# Built from the MONOREPO ROOT as the build context so the pnpm workspace
# (root manifest + lockfile + packages/kernel + packages/contracts + apps/audit)
# is available:
#   docker build -f apps/audit/Dockerfile -t audit .
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
COPY apps/audit/package.json apps/audit/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build: compile kernel + contracts + app ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @kernel/core run build \
 && pnpm --filter @contracts/core run build \
 && pnpm --filter @app/audit run build

# ---------- prod-deps: prune to production node_modules ----------
FROM base AS prod-deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json packages/kernel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/authz/package.json packages/authz/package.json
COPY apps/audit/package.json apps/audit/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---------- runner: slim runtime image ----------
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Workspace layout so `pnpm --filter` and the migration scripts resolve. NOTE:
# @contracts/core is a pure-TS package with ZERO runtime deps, so pnpm creates no
# packages/contracts/node_modules to copy — it is resolved via the symlink inside
# apps/audit/node_modules/@contracts/core -> packages/contracts (whose
# package.json + dist are copied below). Only kernel has a runtime dep (uuid).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/kernel/node_modules ./packages/kernel/node_modules
COPY --from=prod-deps /app/apps/audit/node_modules ./apps/audit/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json ./packages/kernel/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY apps/audit/package.json ./apps/audit/package.json

# Compiled output + the TS sources the migration CLI runs via ts-node.
COPY --from=build /app/packages/kernel/dist ./packages/kernel/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/audit/dist ./apps/audit/dist
COPY apps/audit/src ./apps/audit/src
COPY apps/audit/tsconfig.json apps/audit/tsconfig.build.json ./apps/audit/
COPY tsconfig.base.json ./tsconfig.base.json

EXPOSE 3100
# Run the compiled entrypoint. Migration is invoked explicitly (see README):
# `docker compose run --rm audit pnpm migration:run`.
CMD ["node", "apps/audit/dist/main.js"]
