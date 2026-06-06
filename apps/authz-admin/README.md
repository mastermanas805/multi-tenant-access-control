# Authorization Admin (PAP) — NestJS

The **Policy Administration Point** for the multi-tenant access-control platform
(DESIGN §8). It owns tenants, the org-unit hierarchy, the global permission
catalog, RBAC roles, role assignments, and policy versions — the write-side
source of truth that compiles into Cerbos policies for the PDP.

Hexagonal architecture (domain → application → infrastructure → presentation),
one module per aggregate, all replicating the `tenant` reference module:

| Module           | Aggregate / table   | Tenant-scoped? | Key routes (`/v1`)                                            |
| ---------------- | ------------------- | -------------- | ------------------------------------------------------------- |
| `tenant`         | `tenants`           | global (root)  | `POST /tenants`, `GET /tenants/:id`, `POST /tenants/:id/suspend` |
| `org-unit`       | `org_units`         | yes (RLS)      | `POST /org-units`, `GET /org-units/:id`, subtree, move        |
| `permission`     | `permissions`       | **global**     | `POST /permissions`, `GET /permissions`                       |
| `role`           | `roles`, `role_permissions` | yes (RLS) | `POST /roles`, grant/revoke permission                        |
| `role-assignment`| `role_assignments`  | yes (RLS)      | `POST /role-assignments`, revoke, list-for-user              |
| `policy`         | `policies`          | yes (RLS)      | `POST /policies` (publish), activate, rollback               |

## Quick start (Docker)

From the **repository root**:

```bash
# 1. Start Postgres 16 + the API (multi-stage Docker build).
docker compose up -d --build

# 2. Create the schema, indexes, and RLS policies (run as the bootstrap
#    superuser; this also provisions the non-superuser `authz_app` role the API
#    connects as).
docker compose run --rm -e DB_USERNAME=authz -e DB_PASSWORD=authz \
  authz-admin pnpm migration:run

# 3. Load demo data (Acme/Globex, org units, permissions, roles, assignments).
docker compose run --rm -e DB_USERNAME=authz -e DB_PASSWORD=authz \
  authz-admin pnpm seed

# 4. Restart the API so it connects now that the schema + app role exist.
docker compose restart authz-admin

# 5. Open the API docs.
open http://localhost:3000/docs        # OpenAPI / Swagger UI
```

Health probe: `curl http://localhost:3000/health`.

### Why two database roles?

Postgres **Row Level Security is bypassed by superusers and any `BYPASSRLS`
role — even with `FORCE ROW LEVEL SECURITY`**. So:

- **migrations + seed** run as the privileged bootstrap user (`authz`), which
  needs DDL and must write across tenants;
- the **long-running API** connects as `authz_app` — a `NOSUPERUSER
  NOBYPASSRLS` role provisioned by the migration — so tenant isolation is
  actually enforced at the database layer.

`docker compose` already points the API at `authz_app`; the migration/seed
commands above override `DB_USERNAME`/`DB_PASSWORD` back to the bootstrap user.

## Running on the host (without Docker for the app)

```bash
cp ../../.env.example ../../.env     # or apps/authz-admin/.env
pnpm install                          # from the repo root

# Bootstrap (DDL + cross-tenant writes) runs as the PRIVILEGED bootstrap
# superuser, so override the default unprivileged runtime credentials for these
# two commands only. The migration also provisions the `authz_app` role.
DB_USERNAME=authz DB_PASSWORD=authz pnpm --filter @app/authz-admin run migration:run
DB_USERNAME=authz DB_PASSWORD=authz pnpm --filter @app/authz-admin run seed:dev   # ts-node; no build needed

# The long-running API connects as the UNPRIVILEGED `authz_app` role (the
# .env.example default), so FORCE ROW LEVEL SECURITY is enforced. The app fails
# closed at boot if the runtime role is a superuser or has BYPASSRLS.
pnpm --filter @app/authz-admin run start:dev   # http://localhost:3000/docs
```

> `seed` runs the **compiled** `dist/.../seed.js` (so it works in the slim
> production Docker image, which has no `ts-node`); run `pnpm build` first, or
> use `seed:dev` which runs the TypeScript source via `ts-node` for local
> iteration.

## Tenant context (demo)

Tenant isolation is enforced in three layers (ARCHITECTURE §5). In production the
tenant id is the verified JWT `tid` claim; **for the demo** the
`TenantContextGuard` reads an `x-tenant-id` header and the `RlsInterceptor` opens
a transaction with `SET LOCAL app.current_tenant = <id>` so Postgres RLS scopes
every query. Seeded tenant ids:

- Acme (pool): `aaaaaaaa-0000-4000-8000-000000000001`
- Globex (silo): `bbbbbbbb-0000-4000-8000-000000000002`

```bash
# List Acme's roles (only Acme rows are visible thanks to RLS):
curl -s http://localhost:3000/v1/roles \
  -H 'x-tenant-id: aaaaaaaa-0000-4000-8000-000000000001' | jq
```

## Scripts

| Script                | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `build` / `typecheck` | `tsc -b` the app                                     |
| `start` / `start:dev` | run compiled / ts-node-dev                           |
| `test` / `test:e2e`   | unit (jest) / e2e (boots the real `AppModule`)       |
| `migration:run`       | apply migrations (schema + indexes + RLS + app role) |
| `migration:revert`    | revert the last migration                            |
| `migration:show`      | list applied/pending migrations                      |
| `seed`                | load idempotent demo data                            |

## Data & storage notes (DESIGN §8.5–8.6)

- **Org hierarchy** uses a materialized `path` (`acme.finance.emea`) = the Cerbos
  scope. The migration enables `ltree` + `btree_gist` and builds a composite
  `GIST(tenant_id, ltree(path))` index for tenant-scoped subtree queries; it
  falls back to a `text_pattern_ops` btree if those extensions are unavailable.
- **Hot-path indexes:** `role_assignments(tenant_id,user_id)` &
  `(tenant_id,role_id)`, `roles(tenant_id,key)` unique, `permissions(key)`
  unique, `policies(tenant_id,scope,version)` unique.
- **RLS** is `ENABLE`d + `FORCE`d on every tenant-scoped table with
  `USING (tenant_id = current_setting('app.current_tenant', true)::uuid)`. The
  `tenants` and `permissions` tables are the global exception (no `tenant_id`,
  no RLS).
```
