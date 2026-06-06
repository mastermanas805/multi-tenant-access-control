# syntax=docker/dockerfile:1

# Multi-stage build for the Authorization Admin (PAP) NestJS service.
# Built from the MONOREPO ROOT as the build context so the pnpm workspace
# (root manifest + lockfile + packages/kernel + apps/authz-admin) is available:
#   docker build -f apps/authz-admin/Dockerfile -t authz-admin .
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
COPY apps/authz-admin/package.json apps/authz-admin/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build: compile kernel + app ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @kernel/core run build \
 && pnpm --filter @app/authz-admin run build

# ---------- prod-deps: prune to production node_modules ----------
FROM base AS prod-deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json packages/kernel/package.json
COPY apps/authz-admin/package.json apps/authz-admin/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---------- runner: slim runtime image ----------
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Workspace layout so `pnpm --filter` and the migration/seed scripts resolve.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/kernel/node_modules ./packages/kernel/node_modules
COPY --from=prod-deps /app/apps/authz-admin/node_modules ./apps/authz-admin/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kernel/package.json ./packages/kernel/package.json
COPY apps/authz-admin/package.json ./apps/authz-admin/package.json

# Compiled output + the TS sources the migration/seed CLI runs via ts-node.
COPY --from=build /app/packages/kernel/dist ./packages/kernel/dist
COPY --from=build /app/apps/authz-admin/dist ./apps/authz-admin/dist
COPY apps/authz-admin/src ./apps/authz-admin/src
COPY apps/authz-admin/tsconfig.json apps/authz-admin/tsconfig.build.json ./apps/authz-admin/
COPY tsconfig.base.json ./tsconfig.base.json

EXPOSE 3000
# Run the compiled entrypoint. Migration + seed are invoked explicitly
# (see README): `docker compose run --rm authz-admin pnpm migration:run`.
CMD ["node", "apps/authz-admin/dist/main.js"]
