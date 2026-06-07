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

## Quick start (full stack)

From the **repository root** — the PAP is brought up as part of the whole stack and
its schema/seed are provisioned by the one-command bootstrap:

```bash
docker compose up -d --build      # postgres, cerbos, identity, authz-admin, audit, expense, gateway
./scripts/bootstrap.sh            # migrate + seed all DBs + publish the demo policy
open http://localhost:3000/docs   # OpenAPI / Swagger UI
```

See **[RUNNING.md](../../RUNNING.md)** for the end-to-end demo and troubleshooting.
The bootstrap runs the migrations + seeds from the host (the slim runtime image is
production-only) as the bootstrap superuser — this also provisions the non-superuser
`authz_app` role + RLS the API connects as, so the API self-recovers once it has run.
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

## Dynamic policy publishing to Cerbos (DESIGN §3.4, §8.7, FR-8)

Publishing/activating/rolling back a policy makes it **effective in the Cerbos PDP
within seconds**, with nothing hardcoded. On each of those use-cases the PAP:

1. compiles the policy's DB jsonb (`Policy.rule`, a `@contracts/core`
   `PolicyRuleBody`) into a Cerbos `resourcePolicy` via the shared
   `compilePolicyToCerbos` (`@authz/pep`);
2. injects the tenant-isolation guardrail as the first rule and emits empty-rules
   passthrough stubs for every missing ancestor scope (Cerbos requires the whole
   scope chain to exist);
3. writes the YAML into `CERBOS_POLICY_DIR` — the **same dir Cerbos watches**
   (`watchForChanges`), so it hot-reloads with no restart.

The adapter is bound behind an application port (`POLICY_PUBLISHER`). The
`CERBOS_PUBLISH_ENABLED` toggle swaps in a no-op publisher (used by the test
suites) so the use-cases run without a filesystem or a live PDP.

| Env                     | Default                  | Purpose                                            |
| ----------------------- | ------------------------ | -------------------------------------------------- |
| `CERBOS_PUBLISH_ENABLED`| `true`                   | `false` → no-op publisher (no disk write)          |
| `CERBOS_POLICY_DIR`     | `deploy/cerbos/policies` | shared dir the PDP watches (compose bind-mount)    |
| `CERBOS_URL`            | `localhost:3593`         | PDP gRPC endpoint (diagnostics / PEP symmetry)     |

```bash
# Publish a policy for scope acme.finance; the PAP writes
# deploy/cerbos/policies/expense_report.acme.finance.yaml (+ the acme stub),
# which Cerbos hot-reloads.
curl -s -X POST http://localhost:3000/v1/policies \
  -H 'x-tenant-id: aaaaaaaa-0000-4000-8000-000000000001' \
  -H 'content-type: application/json' \
  -d '{"scope":"acme.finance","effectiveDate":"2026-07-01T00:00:00.000Z",
       "rule":{"resource":"expense_report","rules":[
         {"name":"finance_manager_approve","actions":["read","approve"],
          "effect":"ALLOW","roles":["finance_manager"],
          "condition":{"all":[{"expr":"request.resource.attr.amount < 10000"}]}}]}}' | jq
```

## PIP — principal resolution (DESIGN §3.2, §3.5)

`GET /v1/principals/:userId/effective?tenantId=&scope=` returns the
`@contracts/core` `EffectivePrincipal` `{ id, tenantId, roles[], attr }` — the
read model the Expense PEP consumes via `@authz/pep`'s `HttpPipClient`. Roles are
resolved from the principal's `role_assignments` joined with `roles` (role
**keys**, not UUIDs), honoring **scope inheritance up the org path**: a role
granted at any ancestor scope is effective at the requested (narrower) scope.
This is a trusted service-to-service read, so the tenant comes from the `tenantId`
query param (the PEP's call contract) rather than the `x-tenant-id` header; RLS
still scopes every read.

```bash
# Riya is finance_manager @ acme.finance.emea → resolve at that scope:
curl -s 'http://localhost:3000/v1/principals/riya/effective?tenantId=aaaaaaaa-0000-4000-8000-000000000001&scope=acme.finance.emea' | jq
# → {"id":"riya","tenantId":"aaaa…","roles":["finance_manager"],"attr":{"tenantId":"aaaa…","department":"finance"}}
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
