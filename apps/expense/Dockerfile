# syntax=docker/dockerfile:1

# Multi-stage build for the Expense (PEP) NestJS service.
# Built from the MONOREPO ROOT as the build context so the pnpm workspace
# (root manifest + lockfile + packages/* + apps/expense) is available:
#   docker build -f apps/expense/Dockerfile -t expense .
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
COPY apps/expense/package.json apps/expense/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build: compile kernel + contracts + authz + app ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @kernel/core run build \
 && pnpm --filter @contracts/core run build \
 && pnpm --filter @authz/pep run build \
 && pnpm --filter @app/expense run build

# ---------- prod-deps: prune to production node_modules ----------
FROM base AS prod-deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json packages/kernel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/authz/package.json packages/authz/package.json
COPY apps/expense/package.json apps/expense/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---------- runner: slim runtime image ----------
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Workspace layout so `pnpm --filter` and the migration/seed scripts resolve. NOTE:
# @contracts/core is a pure-TS package with ZERO runtime deps, so pnpm creates no
# packages/contracts/node_modules to copy — it is resolved via the symlink inside
# apps/expense/node_modules/@contracts/core -> packages/contracts (whose
# package.json + dist are copied below). kernel (uuid) and authz (@cerbos/grpc)
# DO have runtime deps, so their node_modules are copied.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/kernel/node_modules ./packages/kernel/node_modules
COPY --from=prod-deps /app/packages/authz/node_modules ./packages/authz/node_modules
COPY --from=prod-deps /app/apps/expense/node_modules ./apps/expense/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json ./packages/kernel/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/authz/package.json ./packages/authz/package.json
COPY apps/expense/package.json ./apps/expense/package.json

# Compiled output + the TS sources the migration/seed CLI runs via ts-node.
COPY --from=build /app/packages/kernel/dist ./packages/kernel/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/authz/dist ./packages/authz/dist
COPY --from=build /app/apps/expense/dist ./apps/expense/dist
COPY apps/expense/src ./apps/expense/src
COPY apps/expense/tsconfig.json apps/expense/tsconfig.build.json ./apps/expense/
COPY tsconfig.base.json ./tsconfig.base.json

EXPOSE 3000
# Run the compiled entrypoint. Migration + seed are invoked explicitly
# (see README): `docker compose run --rm expense pnpm migration:run`.
CMD ["node", "apps/expense/dist/main.js"]
