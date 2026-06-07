# syntax=docker/dockerfile:1

# Multi-stage build for the Identity Service (OIDC-style IdP) NestJS app.
# Built from the MONOREPO ROOT as the build context so the pnpm workspace
# (root manifest + lockfile + packages/kernel + packages/contracts + the app)
# is available:
#   docker build -f apps/identity/Dockerfile -t identity .
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
COPY apps/identity/package.json apps/identity/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build: compile kernel + contracts + app ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @kernel/core run build \
 && pnpm --filter @contracts/core run build \
 && pnpm --filter @app/identity run build

# ---------- prod-deps: prune to production node_modules ----------
FROM base AS prod-deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json packages/kernel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/identity/package.json apps/identity/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---------- runner: slim runtime image ----------
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Workspace layout so `pnpm --filter` and module resolution work. NOTE:
# @contracts/core is a pure-TS package with ZERO runtime deps, so pnpm creates
# no packages/contracts/node_modules to copy — it is resolved via the symlink
# inside apps/identity/node_modules/@contracts/core -> packages/contracts (whose
# package.json + dist are copied below). Only kernel has a runtime dep (uuid).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/kernel/node_modules ./packages/kernel/node_modules
COPY --from=prod-deps /app/apps/identity/node_modules ./apps/identity/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json ./packages/kernel/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY apps/identity/package.json ./apps/identity/package.json

# Compiled output.
COPY --from=build /app/packages/kernel/dist ./packages/kernel/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/identity/dist ./apps/identity/dist
# Dev signing keypair (resolved relative to dist as ../../keys). Override in prod
# with JWT_PRIVATE_KEY(_PATH)/JWT_PUBLIC_KEY(_PATH).
COPY apps/identity/keys ./apps/identity/keys

EXPOSE 3100
CMD ["node", "apps/identity/dist/main.js"]
