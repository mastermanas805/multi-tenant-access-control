# Test strategy

This repository proves the multi-tenant access-control platform end to end across
**four tiers**, deliberately layered so every customer flow is verified at the
cheapest level that can still prove it, and the load-bearing flows are *also*
verified against real infrastructure and through a real browser. No flow rests on
mocks alone.

> The architecture and rationale live in [DESIGN.md](./DESIGN.md); the per-flow
> proof matrix is in [CUSTOMER_FLOWS.md](./CUSTOMER_FLOWS.md); how to bring the
> stack up is in [RUNNING.md](./RUNNING.md).

## The four tiers at a glance

| Tier | What it exercises | Infra | Mocks? | Command | Count |
|---|---|---|---|---|---|
| **1. Unit** | Domain entities, value objects, use-cases, the reusable `@authz/pep` toolkit, the audit hash chain, config schemas — pure logic with ports stubbed in-memory | none (in-process) | ports stubbed | `pnpm test` | **45 suites / 221 tests** |
| **2. Service e2e** | Each service booted as its real NestJS `AppModule` over HTTP (Supertest) — controllers, guards, pipes, the §8.1 error envelope, auth edge | in-process app; DB/PDP faked at the port | repo/PDP/PIP fakes | `pnpm test:e2e` | **11 suites / 74 tests** |
| **3. Integration (Testcontainers)** | The canonical access-control cases against **real Postgres + real Cerbos** — the PEP → PDP → PIP path, RLS isolation, the audit hash chain, and the gateway authN edge, all in-process against throwaway containers | **real** Postgres 16 + **real** Cerbos (Testcontainers) | **none** | `pnpm test:integration` | **3 suites / 19 tests** |
| **4. UI e2e (Playwright)** | **Every** customer flow driven through the **real Demo SPA** → gateway → the five services → Cerbos + Postgres, in a real Chromium | **whole compose stack** (`docker compose up` + bootstrap) | **none** (one negative-auth test forces a bad credential) | `pnpm test:playwright` | **6 files / 12 tests** |

**Total: 65 suites/files · 326 automated checks.** (The Playwright login spec is
parametrized over the three seeded users, so its 6 source files expand to 12 runtime tests.)

---

## Tier 1 — Unit tests (`pnpm test`)

**What it covers & why.** The domain core is where the access-control *logic*
lives, so it gets the densest coverage. Each aggregate's entities, value objects
and use-cases are tested in isolation with their ports (repositories, PDP, PIP,
audit sink, clock) replaced by in-memory fakes. This is where we prove the rules
that the higher tiers then confirm against real infra:

- **`packages/kernel`** (8) — `Entity`/`AggregateRoot` identity & equality,
  `UniqueEntityId`, `Guard`, pagination, the `Clock` port.
- **`packages/authz`** — the reusable PEP toolkit: the `HttpPipClient` + its
  `TtlLruCache` (the cache that makes per-request resolution affordable, and the
  `sensitive:true` fresh-read bypass that enforces FR-8 revocations immediately),
  and the `IdentityContextMiddleware` that reads the signed internal identity
  token (18).
- **`apps/authz-admin`** (PAP, 92) — the largest surface: tenant lifecycle,
  org-unit hierarchy + `ltree` paths, roles & permissions, role assignments,
  **principal resolution with scope inheritance** (the PIP read model), and
  **policy publish/activate/rollback → Cerbos YAML compilation** (FR-8 mechanics,
  including the tenant-isolation guardrail injection and scope-chain stubs).
- **`apps/expense`** (PEP, 20) — the `approve` use-case, the `AuthzGuard`
  behaviour (tenant guardrail before the PDP, ALLOW/DENY → §8.1 envelope, audit
  on both outcomes), and the authorization-aware `list`.
- **`apps/identity`** (IdP, 20) — RS256 token signing/claims (identity + tenant,
  **no roles**), refresh-token rotation, scrypt hashing, JWKS.
- **`apps/gateway`** (41) — JWKS verification (rejects `alg:none`/HS confusion,
  generic 401), the route table (segment-anchored, route-smuggling defense), the
  header policy (strip & re-derive client identity headers — confused-deputy),
  the fixed-window rate limiter, internal-token minting.
- **`apps/audit`** (22) — the **hash chain** (genesis link, tamper detection,
  reorder/delete detection), the record-from-decision mapper, verify-chain.

**Run it:**
```bash
pnpm test                       # all packages + apps (pnpm -r run test)
pnpm --filter @app/gateway run test          # one service
pnpm --filter @app/gateway run test -- bearer-token   # one file/pattern
```

## Tier 2 — Service e2e (`pnpm test:e2e`)

**What it covers & why.** Unit tests stub the HTTP layer; this tier boots each
service's **real `AppModule`** (NestJS DI graph, global `ValidationPipe`, the
`GlobalExceptionFilter` that renders the §8.1 envelope, guards & middleware) and
drives it over HTTP with Supertest. The persistence/PDP/PIP ports are bound to
in-memory or stub adapters so the suite stays hermetic and fast, but everything
above the port — routing, validation, status codes, error envelopes, the auth
edge — is the real wiring a client would hit.

- **gateway** (10) — valid JWT → 200 + forwarded server-derived headers; missing
  → 401; **forged `x-tenant-id`/`x-internal-identity` ignored** (confused-deputy);
  unknown path → edge 404.
- **identity** (7) — password grant → token pair; wrong password → generic 401
  (no account enumeration); refresh rotation; JWKS shape.
- **expense** (6) — `approve` ALLOW/DENY/cross-tenant through the real guard with
  a stubbed PDP/PIP; the PDP-filtered list.
- **authz-admin** (43) — full PAP CRUD across tenant, org-unit, permission, role,
  role-assignment, **policy** and **principal** controllers, including the
  tenant-context guard and the §8.1 envelope for every error path.
- **audit** (8) — append + list + **verify** over the controller, idempotent
  re-append, the chain endpoint.

**Run it:**
```bash
pnpm test:e2e                                # all services (pnpm -r run test:e2e)
pnpm --filter @app/authz-admin run test:e2e  # one service
```

## Tier 3 — Integration (Testcontainers) (`pnpm test:integration`)

**What it covers & why.** This is the tier that removes the mocks from the
load-bearing path. It boots **real Postgres 16 and real Cerbos** via
[Testcontainers](https://testcontainers.com) (random host ports, dropped after the
run), runs the migrations + seeds, **publishes the demo policy through the PAP**
(so Cerbos hot-reloads a *runtime-defined* rule, exactly as production does — never
a pre-baked policy), and then evaluates the canonical cases with the real PEP →
Cerbos PDP → PIP path in-process. It is the proof that the policy logic, the
attribute plumbing, RLS, and the hash chain all behave against genuine engines.

`tests/integration/src/` (3 suites, 19 checks):

- **`flows.int-spec.ts`** — the canonical decision matrix:
  (a) Riya approves $8,500 same-dept → **200 ALLOW**;
  (b) Riya approves $25,000 → **403** (ABAC `amount < 10000`) with reason;
  (c) Riya approves a Globex expense → **403** (tenant guardrail);
  (c2) a Globex principal sees only Globex and Acme cannot reach it;
  (d) Sam (engineer) approves → **403** (RBAC: no rule grants it);
  (e) **FR-8** — revoke Riya's `finance_manager` via the PAP → the *same* approve
  flips to **403** within the staleness bound (no redeploy);
  plus: every decision (ALLOW **and** DENY) is appended to the **real hash-chained
  audit log** and the chain **verifies** intact.
- **`gateway-auth.int-spec.ts`** — the gateway authN edge with a **real RS256
  JWT** from the identity service: valid → 200 + server-derived identity
  forwarded; forged `x-tenant-id`/`x-internal-identity` overwritten (§7); missing
  → 401 (no upstream hop); tampered signature → 401; unknown path → 404.
- **`rls-isolation.int-spec.ts`** — **Postgres RLS** with the unprivileged runtime
  role: the role is confirmed `NOSUPERUSER`/`NOBYPASSRLS`; an Acme-bound query
  cannot read a specific Globex row; the Acme expense context returns **no** Globex
  rows.

**Requires Docker.** First run pulls the Postgres + Cerbos images.

**Run it:**
```bash
pnpm test:integration           # = pnpm --filter @tests/integration run test:integration
```

## Tier 4 — UI e2e (Playwright) (`pnpm test:playwright`)

**What it covers & why.** The top tier proves the **whole product** the way a
customer experiences it: a real Chromium drives the real Demo SPA
([`apps/web`](./apps/web), nginx on `:8081`) through the **gateway** (`:8080`) to
the five services, Cerbos and Postgres — **no mocks, no request stubbing** (the
single exception is one negative-auth test that rewrites the password to force the
server's 401). Every assertion checks **both** the visible UI result **and** the
captured server response (HTTP status + the body's `decisionId`/`reason`), so a UI
that merely *looked* right cannot pass — the test always confirms the decision
came from the server-side PEP/PDP.

`globalSetup` brings the **entire compose stack up** (`docker compose up -d
--build` + `scripts/bootstrap.sh`, with Postgres remapped to host port `5544` so
it never collides with a developer's local `:5432`), waits for every `/health`
endpoint **and** for the runtime-published Cerbos policy to be **effective**, then
waits for the SPA. `globalTeardown` runs `docker compose down -v`. Single worker,
no sleeps: every wait is on a `data-testid` or a captured network `Response`.

`e2e/tests/` (6 files → 12 runtime tests):

| File | Flow |
|---|---|
| `01-auth.spec.ts` | seeded-user list renders; login as Riya / Sam / Dev → 200 + real 3-part JWT + role label (parametrized → 3 tests); invalid credentials → server 401 + `login-error`, no session (5 tests total). |
| `02-decisions.spec.ts` | Riya: approve `exp_42` ($8.5k same-dept) → ALLOW (200) + decisionId; `exp_99` ($25k) → DENY (403, ABAC `amount<10000`); Globex `exp_glx` → DENY (cross-tenant, RLS-invisible 404), asserted **not** an ABAC failure (3 tests). |
| `03-rbac.spec.ts` | Sam (engineer) approve `exp_42` → DENY (403, no rule grants it) (1 test). |
| `04-dynamic-fr8.spec.ts` | Dev revokes Riya's `finance_manager` via the Admin screen (PAP) → Riya's approve flips to DENY; Dev re-grants → Riya's approve is authorized again — **live, no redeploy** (1 test). |
| `05-audit.spec.ts` | the decision-log panel (read through the gateway from the audit service) shows a real ALLOW and a real DENY entry, each with reason + decisionId, cross-checked against the approve responses (1 test). |
| `06-security-ux.spec.ts` | Sam's Approve button is **visible and enabled**; clicking it returns a server 403 — proving UI-hiding is UX, not the gate (DESIGN §13) (1 test). |

**Requires Docker.** First run also needs the Chromium browser binary.

**Run it:**
```bash
# from the repo root
pnpm test:playwright

# first time only (installs the browser)
pnpm --filter @tests/e2e-playwright exec playwright install --with-deps chromium

# iterate against an already-running stack (skip compose up/down)
E2E_SKIP_STACK=1 pnpm test:playwright

# view the HTML report
pnpm --filter @tests/e2e-playwright run report
```

---

## How to run everything

```bash
pnpm install                    # once

# static + fast tiers (no Docker)
pnpm -w run typecheck
pnpm -w run build
pnpm -w run lint
pnpm test                       # Tier 1 — unit
pnpm test:e2e                   # Tier 2 — service e2e

# infra-backed tiers (Docker required)
pnpm test:integration          # Tier 3 — Testcontainers (real PG + Cerbos)
pnpm test:playwright           # Tier 4 — full-stack UI e2e (compose up + bootstrap + down)
```

Tiers 1–2 are hermetic and need no Docker; tier 3 spins up throwaway containers;
tier 4 brings the whole compose stack up and tears it down (`down -v`) itself.

---

## Customer flow → test mapping

Every customer flow and which tier(s)/file(s) prove it. The fuller per-flow detail
(actor, steps, expected result) is in [CUSTOMER_FLOWS.md](./CUSTOMER_FLOWS.md).

| # | Customer flow (FR / DESIGN §) | Unit | Service e2e | Integration | Playwright UI |
|---|---|---|---|---|---|
| **A1** | **AuthN** — login (password grant) → RS256 JWT (identity + tenant, no roles) | `apps/identity/.../issue-token.use-case.spec.ts`, `crypto-token-signer.spec.ts` | `identity.e2e-spec.ts` | `gateway-auth.int-spec.ts` (issues real JWT) | `01-auth.spec.ts` |
| **A2** | **AuthN** — wrong password → generic 401, no enumeration | `scrypt-password-hasher.spec.ts` | `identity.e2e-spec.ts` | — | `01-auth.spec.ts` (invalid creds → 401) |
| **A3** | **AuthN** — refresh-token rotation (single-use) | `refresh-token.use-case.spec.ts` | `identity.e2e-spec.ts` | — | — |
| **A4** | **Edge authN** — valid JWT → 200; missing/tampered → 401; unknown path → 404 | `jwks-token-verifier.spec.ts`, `bearer-token.vo.spec.ts`, `route-table.spec.ts` | `gateway.e2e-spec.ts` | `gateway-auth.int-spec.ts` | `01-auth.spec.ts` (login through gateway) |
| **B1** | **Authz ALLOW** — Riya approves $8.5k same-dept → 200 + decisionId (RBAC+ABAC) | `approve-expense.use-case.spec.ts`, `expense-authz-guard.spec.ts` | `expense.e2e-spec.ts` | `flows.int-spec.ts` (a) | `02-decisions.spec.ts` |
| **B2** | **Authz DENY (ABAC)** — Riya approves $25k → 403 (`amount<10000`) + reason | `expense-authz-guard.spec.ts`, `compile-policy` tests | `expense.e2e-spec.ts` | `flows.int-spec.ts` (b) | `02-decisions.spec.ts` |
| **B3** | **Uniform decision API** — allow/deny **+ reason + decisionId** (§8.1 envelope, FR-6) | `expense-authz-guard.spec.ts`, `global-exception.filter` | `expense.e2e-spec.ts`, `gateway.e2e-spec.ts` | `flows.int-spec.ts` (a/b) | `02-decisions.spec.ts`, `05-audit.spec.ts` |
| **C1** | **RBAC** — Sam (engineer, no grant) approve → 403 (no rule matches) | `expense-authz-guard.spec.ts` | `expense.e2e-spec.ts` | `flows.int-spec.ts` (d) | `03-rbac.spec.ts` |
| **C2** | **RBAC + scope inheritance** — role at ancestor scope effective at narrower scope (PIP) | `resolve-principal.use-case.spec.ts`, `scope-chain.vo` | `principal.e2e-spec.ts` | `flows.int-spec.ts` (a, via real PIP) | covered transitively by `02`/`04` |
| **D1** | **Dynamic policy/role mgmt (FR-8)** — revoke grant → next decision flips to DENY, no redeploy | `revoke-role.use-case.spec.ts`, `publish-policy.use-case.spec.ts`, `ttl-lru-cache`/sensitive-read | `role-assignment.e2e-spec.ts`, `policy.e2e-spec.ts` | `flows.int-spec.ts` (e) | `04-dynamic-fr8.spec.ts` |
| **D2** | **Dynamic policy publish → Cerbos hot-reload** (compile + guardrail + scope stubs) | `cerbos-policy-mapper.spec.ts`, `fs-cerbos-policy.publisher.spec.ts` | `policy.e2e-spec.ts` | `flows.int-spec.ts` (publishes through PAP) | `04-dynamic-fr8.spec.ts` (grant re-publishes) |
| **E1** | **Tenant isolation** — cross-tenant resource invisible (guardrail + RLS) | `expense-authz-guard.spec.ts` (guardrail) | `expense.e2e-spec.ts` | `flows.int-spec.ts` (c/c2), `rls-isolation.int-spec.ts` | `02-decisions.spec.ts` (Globex) |
| **E2** | **RLS at the DB** — unprivileged role, no bypass, no Globex rows in Acme context | `tenant-context`/`rls.interceptor` unit | — | `rls-isolation.int-spec.ts` | covered transitively (cross-tenant flow) |
| **F1** | **Service-to-service re-auth** — gateway mints signed internal token; PEP re-resolves principal each hop (FR-7) | `hmac-internal-token-minter`, `identity-context.middleware.spec.ts` | `gateway.e2e-spec.ts`, `expense.e2e-spec.ts` | `gateway-auth.int-spec.ts` + `flows.int-spec.ts` | `02`/`04` (every approve re-resolves) |
| **F2** | **Confused-deputy defense** — forged identity/tenant headers stripped & re-derived | `header-contract.spec.ts`, `forwarded-headers.spec.ts` | `gateway.e2e-spec.ts` | `gateway-auth.int-spec.ts` | covered by F1 (gateway always re-derives) |
| **G1** | **Admin CRUD (PAP / FR-10)** — tenants, org-units, roles, permissions, assignments, policies | per-aggregate `*.use-case.spec.ts` (×many) | `tenant/org-unit/role/permission/role-assignment/policy.e2e-spec.ts` | seeded + driven in `flows.int-spec.ts` | `04-dynamic-fr8.spec.ts` (Admin screen grant/revoke) |
| **H1** | **Audit (FR-9)** — every decision (allow+deny) recorded; tamper-evident hash chain verifies | `hash-chain.spec.ts`, `record-audit-event.use-case.spec.ts`, `verify-chain.use-case.spec.ts` | `audit-event.e2e-spec.ts` | `flows.int-spec.ts` (audits + verifies) | `05-audit.spec.ts` |
| **I1** | **Security-UX** — UI-hiding is not the gate; a denied click returns a real server 403 | — (principle) | `expense.e2e-spec.ts` (server is the gate) | `flows.int-spec.ts` (d) | `06-security-ux.spec.ts` |

Where a row shows a flow proven at multiple tiers, that is intentional: the cheap
tier gives fast feedback on the logic, and the infra/UI tiers prove it survives
contact with real Postgres, real Cerbos, the real gateway, and a real browser.
