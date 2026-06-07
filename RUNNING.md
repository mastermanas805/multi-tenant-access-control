# Running the full enforcement stack

This is the operational guide for bringing up the **whole** multi-tenant
access-control platform locally and running the canonical demo (DESIGN §11):
Postgres + Cerbos + the five services (identity, authz-admin/PAP, audit, expense/PEP,
gateway). For the architecture and rationale see [DESIGN.md](./DESIGN.md); for each
service's internals see its `apps/<svc>/README.md`.

```
              ┌─────────┐   user JWT (RS256)        ┌──────────┐
   client ───▶│ gateway │──verify JWKS, mint internal──▶│ expense  │ (PEP)
              └────┬────┘   identity token            └────┬─────┘
                   │ /auth/* (public)                       │ Cerbos check (gRPC)
                   ▼                                        ▼
              ┌──────────┐                            ┌──────────┐
              │ identity │ (IdP, RS256 + JWKS)        │  cerbos  │ (PDP, hot-reload)
              └──────────┘                            └────┬─────┘
                                       PIP resolve  ◀──────┤  publish (PAP writes YAML)
              ┌────────────┐  GET /v1/principals/:id/effective  ┌──────────────┐
              │ authz-admin│ (PAP) ◀──────────────────────────  │  expense PEP │
              └─────┬──────┘                                    └──────┬───────┘
                    │ Postgres (RLS, authz_admin DB)                   │ decision (allow/deny)
                    ▼                                                  ▼
              ┌──────────┐                                       ┌──────────┐
              │ postgres │  authz_admin · expense · audit DBs    │  audit   │ (hash chain)
              └──────────┘                                       └──────────┘
```

## Prerequisites

- Docker + Docker Compose
- Node.js 20 and `pnpm@9` on the host (the one-command bootstrap runs the
  migrations/seeds from the host against the compose-exposed Postgres — the slim
  runtime images are production-only and do not ship the migration toolchain)
- `pnpm install` once at the repo root
- `jq` (optional, only for the copy-paste demo curls)

## One command: up + bootstrap

```bash
pnpm install                      # once
docker compose up -d --build      # build + start postgres, cerbos, all 5 services
./scripts/bootstrap.sh            # migrate + seed + publish the demo policy
```

`docker compose up` starts everything. On a **fresh** volume the two OLTP services
(authz-admin, expense) intentionally **fail-closed and restart** until the
bootstrap provisions their unprivileged DB roles — this is the RLS safety guard
(DESIGN §6/§8.3: the API must NOT connect as a superuser), not an error. The
bootstrap then:

1. waits for Postgres + Cerbos;
2. runs the TypeORM migrations for all three databases (`authz_admin`, `audit`,
   `expense`) as the bootstrap **superuser** — this also provisions the
   unprivileged `authz_app` / `expense_app` roles + Row-Level-Security policies the
   long-running APIs connect as;
3. seeds the demo data (tenants Acme/Globex, roles, Riya/Sam/Dev assignments, three
   demo expenses);
4. waits for every service to report healthy (the OLTP apps recover once their roles
   exist);
5. **publishes the demo `expense_report` policy through the PAP** (`POST
   /v1/policies`) so Cerbos hot-reloads a **real, runtime-defined** rule — proving
   policies are published dynamically, **not** baked into the image (FR-8):

   > `finance_manager` may `read`/`approve` an `expense_report` when
   > `amount < 10000` **AND** `resource.department == principal.department`,
   > on top of the platform tenant-isolation guardrail.

6. waits until that policy is **effective** in Cerbos, then prints the demo curls.

Re-running `./scripts/bootstrap.sh` is safe (idempotent).

| Service | URL | Swagger |
|---|---|---|
| **Demo UI (SPA)** | **http://localhost:8081** | — (thin client to the gateway) |
| gateway (edge) | http://localhost:8080 | http://localhost:8080/docs |
| identity (IdP) | http://localhost:3200 | http://localhost:3200/docs |
| authz-admin (PAP) | http://localhost:3000 | http://localhost:3000/docs |
| expense (PEP) | http://localhost:3300 | http://localhost:3300/docs |
| audit | http://localhost:3100 | http://localhost:3100/docs |
| cerbos (PDP) | grpc :3593 / http :3592 | — |

### The Demo UI

Once the stack is up, open **http://localhost:8081** for the Demo SPA
([apps/web](./apps/web)) — a thin client to the gateway that **never makes authz
decisions, it only reflects them** (DESIGN §13). Four screens: **Login / user
switch** (Riya / Sam / Dev), **Expenses** (Approve → the server's 200 ALLOW / 403
DENY + the PDP reason), **Admin** (Dev only — revoke/grant Riya's role, FR-8 live),
and a **Decision-log** panel. The Approve button is shown even for users who will
be denied — hiding it is UX, not security; the PEP is the real gate.

## The demo (DESIGN §11 — the canonical customer flows)

Log in at the Identity IdP for a real RS256 JWT, then drive the PEP through the gateway.

```bash
# 1) Log in as Riya (finance manager) -> RS256 access token
TOKEN=$(curl -sS -X POST http://localhost:3200/v1/auth/token \
          -H 'content-type: application/json' \
          -d '{"email":"riya@acme.com","password":"Password123!"}' | jq -r .accessToken)

# (a) ALLOW — $8,500 same-department expense -> 200 approved + decisionId
curl -sS -X POST http://localhost:8080/v1/expenses/exp_42/approve \
     -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'

# (b) DENY (ABAC: amount < 10000 fails) — $25,000 expense -> 403 + reason + decisionId
curl -sS -X POST http://localhost:8080/v1/expenses/exp_99/approve \
     -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'

# (c) Cross-tenant — the Globex expense is invisible to an Acme principal (RLS) -> 404/403
curl -sS -X POST http://localhost:8080/v1/expenses/exp_glx/approve \
     -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'

# (auth) No token on a protected route -> 401 at the edge
curl -sS -X POST http://localhost:8080/v1/expenses/exp_42/approve \
     -H 'content-type: application/json' -d '{}'
```

Sam (engineer, no finance grant) gets a 403 on the same `approve` (RBAC: no rule
grants it). Log him in with `sam@acme.com` / `Password123!`.

### Inspect the decision log (tamper-evident hash chain)

```bash
# Every decision (allow AND deny) is recorded
curl -sS "http://localhost:3100/v1/audit/events?tenantId=aaaaaaaa-0000-4000-8000-000000000001&limit=10"
# Replay the chain from genesis and confirm it is intact
curl -sS http://localhost:3100/v1/audit/events/verify   # -> {"valid":true,"brokenAt":null,...}
```

### Dynamic policy change (FR-8 — no redeploy)

Revoke Riya's `finance_manager` grant through the PAP, and the very next `approve`
of an otherwise-allowed expense flips to 403 within the staleness bound (the PEP
resolves the principal fresh on the sensitive `approve` path):

```bash
curl -sS -X POST http://localhost:3000/v1/role-assignments/0e000000-0000-4000-8000-000000000001/revoke \
     -H 'x-tenant-id: aaaaaaaa-0000-4000-8000-000000000001' -H 'x-actor-id: dev' -d '{}'
# Re-run (a): now 403 — the role is gone, so no ALLOW rule matches.
```

(Re-run `./scripts/bootstrap.sh` to restore the seed grants.)

## Tests

Four tiers prove the platform end to end — unit, per-service HTTP e2e, Testcontainers
integration (real Postgres + Cerbos), and a full-stack Playwright UI suite that drives
**every** customer flow through the real Demo SPA. Full strategy, counts and the
flow→tier matrix: **[TESTING.md](./TESTING.md)** (the per-flow detail is in
**[CUSTOMER_FLOWS.md](./CUSTOMER_FLOWS.md)**).

```bash
pnpm -w run typecheck          # all projects
pnpm -w run build
pnpm -w run lint
pnpm test                      # unit (45 suites / 221 tests)
pnpm test:e2e                  # per-service HTTP e2e (11 suites / 74 tests)
pnpm test:integration          # Testcontainers: real Postgres + Cerbos (3 suites / 19 tests)
pnpm test:playwright           # full-stack UI e2e (6 files / 12 tests) — Docker required
```

`test:integration` covers: (a) ALLOW $8,500 same-dept; (b) DENY $25,000 (ABAC);
(c) DENY cross-tenant (guardrail/RLS); (d) DENY Sam (RBAC); (e) dynamic revoke ->
DENY (FR-8); (f) Postgres RLS isolation (Acme context sees no Globex rows in
`org_units`/`roles`/`role_assignments`/`expenses`); plus the gateway authN edge
(valid JWT -> 200, invalid -> 401, forged `x-tenant-id` ignored).

### Full-stack UI tests (Playwright)

`pnpm test:playwright` drives the real Demo SPA (**http://localhost:8081**) →
gateway → the five services → Cerbos + Postgres in a real Chromium — no mocks.
Its **global setup brings the whole compose stack up itself** (`docker compose up
-d --build` + `scripts/bootstrap.sh`, Postgres remapped to host port `5544` so it
never collides with a local `:5432`), waits for every `/health` endpoint **and**
the runtime-published Cerbos policy to be effective, then **tears the stack down**
(`docker compose down -v`) on completion. Every assertion checks both the visible
UI **and** the captured server response (status + `decisionId`/`reason`).

```bash
# from the repo root (Docker must be available)
pnpm test:playwright

# first time only — install the browser
pnpm --filter @tests/e2e-playwright exec playwright install --with-deps chromium

# iterate against an already-running stack (skip the compose up/down)
E2E_SKIP_STACK=1 pnpm test:playwright

# open the HTML report
pnpm --filter @tests/e2e-playwright run report
```

It covers every customer flow: auth (login as each seeded user + invalid creds →
401), the ALLOW/ABAC-DENY/cross-tenant decisions, the RBAC denial (Sam), the FR-8
live revoke→DENY→re-grant flip via the Admin screen, the decision-log (ALLOW +
DENY), and the security-UX case (a denied click returns a real server 403).

## Teardown

```bash
docker compose down -v     # stop everything and drop the Postgres volume
```

## Notes & troubleshooting

- **Port 5432 already in use** — another Postgres (host or container) holds it.
  Either stop it, or remap the compose Postgres host port and point the bootstrap at
  it: add a `docker-compose.override.yml` with `postgres.ports: !override ['5544:5432']`
  and run `PG_PORT=5544 ./scripts/bootstrap.sh`.
- **`expense`/`authz-admin` keep restarting before bootstrap** — expected
  (fail-closed until their unprivileged roles exist). They self-recover once the
  bootstrap has migrated.
- **Policies are NOT pre-baked** — `deploy/cerbos/policies/` ships only the platform
  defaults (derived roles + the base tenant-isolation guardrail) plus an
  `example_compiled_*` file for reference; the tenant `acme.finance` rule is written
  there by the PAP at runtime when the bootstrap publishes it.
- **Migrations/seeds run from the host** (full pnpm toolchain) against the
  compose-exposed Postgres, as the bootstrap superuser; the long-running APIs then
  connect as the unprivileged `*_app` roles so Postgres FORCE RLS is actually
  enforced (DESIGN §6/§8.3).
