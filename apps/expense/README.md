# Expense Service (PEP) — NestJS

The worked **Policy Enforcement Point** for the multi-tenant access-control
platform (DESIGN §4.3, §8.2). It owns a single business resource — the
`expenses` table — and demonstrates the reusable `@authz/pep` toolkit end to end:
`POST /v1/expenses/:id/approve` runs the guard → Cerbos PDP, and `GET /v1/expenses`
is an authorization-aware list.

Hexagonal architecture (domain → application → infrastructure → presentation),
identical conventions to the `authz-admin` (PAP) service. The **only** net-new vs
the PAP is the PEP wiring (`AuthzModule` + `@UseGuards(AuthzGuard)` + `@Authorize`).

| Route (`/v1`)                    | Guard / enforcement                                            |
| -------------------------------- | ------------------------------------------------------------- |
| `POST /expenses/:id/approve`     | `IdentityTenantContextGuard` → `AuthzGuard` + `@Authorize('approve')` — PEP flow |
| `GET /expenses`                  | `IdentityTenantContextGuard`; the use-case PDP-filters `read` per row |

## The PEP flow (DESIGN §4.3)

For `approve` the `@authz/pep` `AuthzGuard`:

1. reads `req.authzPrincipal` (set by `IdentityContextMiddleware` from the internal
   identity token — 401 if absent);
2. loads the expense **in-request from this service's own DB** via the route's
   `loadResource` (the `ExpenseResourceLoader`), returning the resource attrs the
   policy references (`tenantId`, `amount`, `department`, `ownerId`) and the
   `scope` that selects the policy chain (`acme.finance`) — 404 if missing;
3. runs the cheap **tenant guardrail** (`resource.tenantId === principal.tenantId`)
   BEFORE the PDP (DESIGN §6 layer 2);
4. resolves the principal's effective roles/attrs via the **PIP** (`sensitive:true`
   forces a fresh read so a just-revoked role is enforced immediately);
5. calls the co-located **Cerbos PDP**;
6. on DENY throws a kernel `ForbiddenError` carrying `reason` + `decisionId` so the
   global filter renders the §8.1 envelope; on ALLOW exposes the decision;
7. emits a `DecisionAuditRecord` (allow **and** deny) to the **Audit sink**.

The `GET /expenses` list mirrors this for a *set*: RLS scopes the candidate rows to
the tenant (layer 1), then the use-case PDP-checks `read` per expense and returns
only the ALLOWs, auditing each decision. (Cerbos `PlanResources` would push the
filter into SQL; the shared PDP client wraps `checkResource` today, so we filter
post-load behind the use-case — a drop-in optimization point.)

## Quick start (Docker)

From the **repository root**. The Expense service depends on the PAP (PIP source),
Cerbos (PDP), and the Audit service, so bring the whole stack up:

```bash
# 1. Start Postgres + Cerbos + the PAP + Audit + the Expense API.
docker compose up -d --build

# 2. Create the PAP schema + demo data (so the PIP can resolve principals).
docker compose run --rm -e DB_USERNAME=authz -e DB_PASSWORD=authz authz-admin pnpm migration:run
docker compose run --rm -e DB_USERNAME=authz -e DB_PASSWORD=authz authz-admin pnpm seed

# 3. Create the Expense schema + RLS + the unprivileged `expense_app` role, then
#    load the demo expenses. Run as the bootstrap superuser (`authz`) against the
#    `expense` database.
docker compose run --rm -e DB_USERNAME=authz -e DB_PASSWORD=authz expense pnpm migration:run
docker compose run --rm -e DB_USERNAME=authz -e DB_PASSWORD=authz expense pnpm seed

# 4. Restart the API so it connects now that the schema + app role exist.
docker compose restart expense

# 5. Open the API docs.
open http://localhost:3300/docs        # OpenAPI / Swagger UI
```

Health probe: `curl http://localhost:3300/health`.

### Why two database roles?

Postgres **Row Level Security is bypassed by superusers and any `BYPASSRLS` role —
even with `FORCE ROW LEVEL SECURITY`**. So migrations + seed run as the privileged
bootstrap user (`authz`, which has DDL and writes across tenants), while the
long-running API connects as `expense_app` — a `NOSUPERUSER NOBYPASSRLS` role the
migration provisions — so tenant isolation is enforced at the DB layer. The app
fails closed at boot if its runtime role is a superuser or has `BYPASSRLS`.

## Identity context (demo)

In production the gateway mints a signed internal identity token (DESIGN §7); the
PEP's `IdentityContextMiddleware` verifies it (swap `verifyToken` for JWKS). **For
the demo** it reads the `x-internal-identity` header = base64url JSON of
`InternalIdentityToken {sub,tid,actorId,sessionId}`. The token `tid` is the tenant
the `IdentityTenantContextGuard` binds for RLS — never a client header/body.

Seeded tenant ids (match the PAP seed):

- Acme: `aaaaaaaa-0000-4000-8000-000000000001`
- Globex: `bbbbbbbb-0000-4000-8000-000000000002`

```bash
# Build a token for riya @ Acme:
TOKEN=$(printf '{"sub":"riya","tid":"aaaaaaaa-0000-4000-8000-000000000001","actorId":"riya","sessionId":"s1"}' | basenc --base64url -w0)

# CASE 1 — ALLOW: $8,500 same-dept finance expense → 200 + decisionId
curl -s -X POST http://localhost:3300/v1/expenses/exp_42/approve \
  -H "x-internal-identity: $TOKEN" -H 'content-type: application/json' -d '{}' | jq

# CASE 2 — DENY: $25,000 → 403 { error:{ reason, decisionId } } (ABAC amount<10000)
curl -s -X POST http://localhost:3300/v1/expenses/exp_99/approve \
  -H "x-internal-identity: $TOKEN" -d '{}' | jq

# CASE 3 — TENANT GUARDRAIL: Globex expense from an Acme token → 403 (cross-tenant)
curl -s -X POST http://localhost:3300/v1/expenses/exp_glx/approve \
  -H "x-internal-identity: $TOKEN" -d '{}' | jq

# Authorization-aware list: only the expenses riya may read (→ [exp_42])
curl -s http://localhost:3300/v1/expenses -H "x-internal-identity: $TOKEN" | jq
```

## Seeded demo expenses

| id        | amount  | dept    | tenant | scope          | expected (riya = finance_manager @ acme.finance) |
| --------- | ------- | ------- | ------ | -------------- | ------------------------------------------------ |
| `exp_42`  | $8,500  | finance | Acme   | `acme.finance` | read/approve **ALLOW** (same dept, < 10,000)     |
| `exp_99`  | $25,000 | finance | Acme   | `acme.finance` | approve **DENY** (amount ≥ 10,000)               |
| `exp_glx` | $4,200  | ops     | Globex | `globex`       | **DENY** by the tenant guardrail (cross-tenant)  |

These align with the committed Cerbos demo policies under `deploy/cerbos/policies`.

## PEP wiring (DESIGN §4.4)

`AuthzModule.forRootAsync` is fed from typed config:

| Env          | Default                  | Purpose                                         |
| ------------ | ------------------------ | ----------------------------------------------- |
| `CERBOS_URL` | `localhost:3593`         | co-located PDP gRPC endpoint (`CerbosPdpClient`)|
| `PAP_URL`    | `http://localhost:3000`  | PIP source — `GET /v1/principals/:id/effective` |
| `AUDIT_URL`  | `http://localhost:3100`  | Audit sink — decision records (allow AND deny)  |

The `PIP_CLIENT` and `AUDIT_SINK` ports are overridable (the test suites supply
fakes); `loadResource` (the `ExpenseResourceLoader`) is the only domain-specific
PEP code — the guard is otherwise domain-agnostic.

## Scripts

| Script                | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `build` / `typecheck` | `tsc -b` the app                                     |
| `start` / `start:dev` | run compiled / ts-node-dev                           |
| `test` / `test:e2e`   | unit (jest, mocked PDP+PIP) / e2e (boots `AppModule`)|
| `migration:run`       | apply migrations (schema + RLS + `expense_app` role) |
| `migration:revert`    | revert the last migration                            |
| `seed`                | load the idempotent demo expenses                    |

## Data & storage notes (DESIGN §6)

- The `expenses` table is **tenant-scoped**: `tenant_id` column + `ENABLE` +
  `FORCE` RLS with `USING (tenant_id = current_setting('app.current_tenant', true)::uuid)`.
- `id` is a human-readable business id (e.g. `exp_42`), not a UUID; the
  `ExpenseId` VO validates it as a bounded URL-safe token.
- `amount` is stored as `numeric(14,2)` (exact) and parsed to a JS number at the
  mapper boundary.
- Resource attributes are loaded **in-request and always fresh** (DESIGN §3.5) —
  never cached — while the PIP read-model (roles/attrs) is the cached cross-service
  input.
```
