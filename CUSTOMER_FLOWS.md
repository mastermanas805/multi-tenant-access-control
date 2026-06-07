# Customer flows

Every customer flow the platform supports, written as **actor → steps → expected
result → where it is tested**, and cross-linked to the design. These are the flows
the brief asks for: authentication, the authorization decisions, RBAC, dynamic
role/policy management (FR-8), tenant isolation, admin CRUD, service-to-service
re-authentication, and the security-UX case.

> Design rationale: [DESIGN.md](./DESIGN.md). Test strategy and the full
> flow→tier matrix: [TESTING.md](./TESTING.md). How to run the stack:
> [RUNNING.md](./RUNNING.md).

**The cast (seeded demo data).** All in tenant **Acme**
(`aaaaaaaa-0000-4000-8000-000000000001`); **Globex**
(`bbbbbbbb-0000-4000-8000-000000000002`) is the second tenant used to prove
isolation.

| Actor | Role | Used for |
|---|---|---|
| **Riya** (`riya@acme.com`) | `finance_manager` @ `acme.finance` | the ALLOW/DENY decisions |
| **Sam** (`sam@acme.com`) | `engineer` (no finance grant) | the RBAC denial + security-UX |
| **Dev** (`dev@acme.com`) | `org_admin` | admin CRUD + FR-8 grant/revoke |

| Expense | Amount | Dept | Tenant | Scope | Expected for Riya |
|---|---|---|---|---|---|
| `exp_42` | $8,500 | finance | Acme | `acme.finance` | read/approve **ALLOW** |
| `exp_99` | $25,000 | finance | Acme | `acme.finance` | approve **DENY** (ABAC `amount<10000`) |
| `exp_glx` | $4,200 | ops | Globex | `globex` | **DENY** (cross-tenant, invisible) |

The canonical rule (published at runtime through the PAP, **not** baked into any
image — see [DESIGN §3.1](./DESIGN.md#L101), [§3.4](./DESIGN.md#s3-4)):

> `finance_manager` may `read`/`approve` an `expense_report` when
> `amount < 10000` **AND** `resource.department == principal.department`, on top
> of the platform tenant-isolation guardrail.

---

## 1. Authentication

### 1.1 Login (password grant) → RS256 JWT
- **Actor:** any seeded user (e.g. Riya), via the Demo SPA login screen or
  `POST /v1/auth/token` through the gateway.
- **Steps:** submit `{email, password}` → gateway routes the public `/auth/*` path
  to the Identity IdP → IdP verifies the scrypt hash and signs an **RS256** access
  token (claims `sub`, `tid`, `sid`, `act`, `iss/aud/iat/exp` — **identity + tenant
  only, no roles**) plus a rotating refresh token.
- **Expected result:** `200` + a 3-part JWT; the SPA holds it **in memory** (never
  `localStorage`) and renders the authenticated shell with the user's role label.
- **Design:** [§5 AuthN/Z flow](./DESIGN.md#s5), [§7](./DESIGN.md#s7), D4 (no roles
  in token) [§12](./DESIGN.md#s12).
- **Tested:** unit `issue-token.use-case.spec.ts`, `crypto-token-signer.spec.ts`;
  e2e `identity.e2e-spec.ts`; integration `gateway-auth.int-spec.ts` (issues a real
  RS256 JWT carrying the Acme tenant UUID); **UI** `e2e/tests/01-auth.spec.ts`.

### 1.2 Login with wrong password → generic 401 (no account enumeration)
- **Actor:** any user with a bad credential.
- **Steps:** submit a wrong password (the UI test intercepts and rewrites the
  request body to force this).
- **Expected result:** `401` with the same generic message regardless of whether
  the user exists (a real hash verify runs even for absent users, so latency does
  not leak existence); the SPA shows `login-error` and **no session** is created.
- **Design:** [§7](./DESIGN.md#s7), [§10](./DESIGN.md#s10).
- **Tested:** unit `scrypt-password-hasher.spec.ts`; e2e `identity.e2e-spec.ts`;
  **UI** `e2e/tests/01-auth.spec.ts` ("invalid credentials show a login error").

### 1.3 Refresh-token rotation (single-use)
- **Actor:** an authenticated client whose access token is near expiry.
- **Steps:** `POST /v1/auth/refresh` with the current refresh token.
- **Expected result:** a new access+refresh pair; the **old** refresh token is
  consumed and a replay is rejected.
- **Design:** [§5](./DESIGN.md#s5), [§10](./DESIGN.md#s10).
- **Tested:** unit `refresh-token.use-case.spec.ts`; e2e `identity.e2e-spec.ts`.

### 1.4 Edge authentication (the gateway is the authN boundary)
- **Actor:** any client hitting a protected route.
- **Steps:** call `/v1/expenses` (or any protected path) with/without a JWT → the
  gateway's `JwtAuthGuard` verifies the RS256 signature against the cached Identity
  **JWKS** (checks `iss/aud/exp/nbf`, rejects `alg:none`/HS confusion).
- **Expected result:** valid JWT → forwarded (200 from upstream); **missing** →
  `401` at the edge (no upstream hop); **tampered signature** → `401`; **unknown
  path** → edge `404` (never silently forwarded).
- **Design:** [§4.1/§4.3](./DESIGN.md#s4), [§7](./DESIGN.md#s7).
- **Tested:** unit `jwks-token-verifier.spec.ts`, `bearer-token.vo.spec.ts`,
  `route-table.spec.ts`; e2e `gateway.e2e-spec.ts`; integration
  `gateway-auth.int-spec.ts`; **UI** `e2e/tests/01-auth.spec.ts` (login flows go
  through the gateway).

---

## 2. The authorization decisions (PEP → PDP)

### 2.1 ALLOW — Riya approves an $8,500 same-department expense
- **Actor:** Riya (`finance_manager` @ `acme.finance`).
- **Steps:** `POST /v1/expenses/exp_42/approve`. The expense PEP: loads `exp_42`
  fresh from its own DB (RLS-scoped to Acme); runs the cheap **tenant guardrail**;
  resolves Riya's effective roles from the **PIP** (`sensitive:true` → fresh read);
  calls the co-located **Cerbos PDP**; the rule matches (`amount 8500 < 10000` AND
  same department).
- **Expected result:** `200` with a `decisionId`; the SPA shows the ALLOW block
  with that same decisionId; an ALLOW is appended to the audit log.
- **Design:** [§3.1 the rule](./DESIGN.md#L101), [§4.3 request lifecycle](./DESIGN.md#s4),
  [§4.4](./DESIGN.md#s4).
- **Tested:** unit `approve-expense.use-case.spec.ts`, `expense-authz-guard.spec.ts`;
  e2e `expense.e2e-spec.ts`; integration `flows.int-spec.ts` (a); **UI**
  `e2e/tests/02-decisions.spec.ts`.

### 2.2 DENY (ABAC) — Riya approves a $25,000 expense
- **Actor:** Riya.
- **Steps:** `POST /v1/expenses/exp_99/approve`. The PDP evaluates the same rule;
  `amount 25000 < 10000` is **false**.
- **Expected result:** `403` with the §8.1 error envelope `{ error: { code:
  "forbidden", reason, decisionId } }`; the SPA shows the DENY block with the PDP's
  deciding-policy reason. Enforced **before** any state transition.
- **Design:** [§3.1](./DESIGN.md#L101), FR-5 fine-grained ABAC [§2.1](./DESIGN.md#s2),
  FR-6 reason in the response.
- **Tested:** unit `expense-authz-guard.spec.ts`, `packages/authz` compile-policy
  tests; e2e `expense.e2e-spec.ts`; integration `flows.int-spec.ts` (b); **UI**
  `e2e/tests/02-decisions.spec.ts`.

### 2.3 Uniform decision API — allow/deny **+ reason + decisionId** (FR-6)
- **Actor:** any caller of any enforced action.
- **Steps:** every PEP enforcement returns the **same shape**: 200 with a
  `decisionId` on ALLOW, or the §8.1 envelope (`code`, `message`, `reason`,
  `decisionId`, `traceId`) on DENY. The gateway streams the upstream envelope back
  **verbatim**, so the PDP reason survives to the client.
- **Expected result:** the SPA renders the reason/decisionId directly; the same
  `decisionId` appears in the audit log.
- **Design:** [§8.1 API conventions](./DESIGN.md#L364), FR-6 [§2.1](./DESIGN.md#s2).
- **Tested:** unit `expense-authz-guard.spec.ts`, `global-exception.filter`; e2e
  `expense.e2e-spec.ts`, `gateway.e2e-spec.ts`; integration `flows.int-spec.ts`;
  **UI** `e2e/tests/02-decisions.spec.ts`, `e2e/tests/05-audit.spec.ts`.

---

## 3. RBAC

### 3.1 Sam (engineer, no finance grant) is denied approve
- **Actor:** Sam (`engineer`), same Acme tenant — so `exp_42` is **visible** to him
  (this is a pure role/policy denial, not a visibility one).
- **Steps:** `POST /v1/expenses/exp_42/approve`. The PIP returns Sam's roles
  (`engineer`); **no ALLOW rule** grants `finance_manager`-only `approve`.
- **Expected result:** `403` (no rule matches), enforced before the state
  transition; the SPA shows the DENY block.
- **Design:** [§3 access-control model](./DESIGN.md#s3), FR-4 tenant-defined roles.
- **Tested:** unit `expense-authz-guard.spec.ts`; e2e `expense.e2e-spec.ts`;
  integration `flows.int-spec.ts` (d); **UI** `e2e/tests/03-rbac.spec.ts`.

### 3.2 Scope inheritance — a role granted at an ancestor scope is effective lower
- **Actor:** a principal whose role is granted at `acme.finance` and who acts on a
  resource scoped to `acme.finance.emea`.
- **Steps:** the **PIP** (`GET /v1/principals/:id/effective?scope=acme.finance.emea`)
  walks the org path and includes roles granted at any ancestor scope.
- **Expected result:** the role is effective at the narrower scope; the PDP allows.
- **Design:** FR-3 hierarchy + inheritance [§2.1](./DESIGN.md#s2), [§3.5 PIP](./DESIGN.md#s3-5),
  [§8.5 org-hierarchy storage](./DESIGN.md#L479).
- **Tested:** unit `resolve-principal.use-case.spec.ts`, `scope-chain.vo`; e2e
  `principal.e2e-spec.ts`; integration `flows.int-spec.ts` (a) drives the real PIP.

---

## 4. Dynamic role / policy management (FR-8)

### 4.1 Revoke a grant → the next decision flips to DENY, no redeploy
- **Actor:** Dev (`org_admin`), then Riya.
- **Steps:** Dev revokes Riya's `finance_manager` assignment via the Admin screen →
  `POST /v1/role-assignments/:id/revoke` (PAP). Switch to Riya → retry
  `POST /v1/expenses/exp_42/approve`. The PEP re-resolves Riya's principal **fresh**
  on the sensitive approve path, so the revocation is seen within the staleness
  bound (no token re-issue, no service restart).
- **Expected result:** the same approve that was ALLOW now returns **403**; the SPA
  banner reflects "takes effect in seconds". Re-granting flips it back to authorized.
- **Design:** [§3.4 dynamic management](./DESIGN.md#s3-4), D4 (per-request resolution)
  [§12](./DESIGN.md#s12), FR-8 [§2.1](./DESIGN.md#s2).
- **Tested:** unit `revoke-role.use-case.spec.ts`, the `TtlLruCache` /
  sensitive-read in `packages/authz`; e2e `role-assignment.e2e-spec.ts`;
  integration `flows.int-spec.ts` (e); **UI** `e2e/tests/04-dynamic-fr8.spec.ts`
  (revoke → DENY → re-grant → authorized).

### 4.2 Publish a policy → Cerbos hot-reloads (no redeploy)
- **Actor:** Dev / a tenant admin (PAP).
- **Steps:** `POST /v1/policies` with a `PolicyRuleBody`. The PAP compiles it to a
  Cerbos `resourcePolicy` (injecting the tenant-isolation guardrail as the first
  rule and emitting passthrough stubs for missing ancestor scopes), writes the YAML
  into the directory Cerbos watches → the PDP hot-reloads with no restart. Activate
  and rollback follow the same path.
- **Expected result:** the new rule is **effective in Cerbos within seconds**;
  nothing is baked into an image. The bootstrap and the test harnesses prove the
  rule is effective before exercising it.
- **Design:** [§3.4](./DESIGN.md#s3-4), [§8.7 policy storage](./DESIGN.md#L501),
  [§11 policy safety](./DESIGN.md#s11), FR-8.
- **Tested:** unit `cerbos-policy-mapper.spec.ts`, `fs-cerbos-policy.publisher.spec.ts`,
  `publish-policy.use-case.spec.ts`; e2e `policy.e2e-spec.ts`; integration
  `flows.int-spec.ts` (publishes the demo policy through the PAP); **UI**
  `e2e/tests/04-dynamic-fr8.spec.ts` (re-grant re-publishes the assignment).

---

## 5. Tenant isolation

### 5.1 Cross-tenant resource is invisible (guardrail + RLS)
- **Actor:** Riya (Acme) acting on `exp_glx` (Globex).
- **Steps:** `POST /v1/expenses/exp_glx/approve`. Riya's request runs inside an
  **Acme-bound RLS transaction**, so the Globex row is **invisible**: the PEP loads
  `null` and fails closed.
- **Expected result:** `404` "Resource not found" — the cross-tenant outcome. It is
  **never** an ABAC `amount` decision (which would mean a Globex row leaked into
  Acme's policy evaluation). The SPA shows a DENY block with a tenant/not-found
  reason.
- **Design:** [§6 multi-tenant isolation](./DESIGN.md#s6) (defense-in-depth: edge
  claim → PDP guardrail → Postgres RLS), D5/D8 [§12](./DESIGN.md#s12), FR-1.
- **Tested:** unit `expense-authz-guard.spec.ts` (guardrail); e2e
  `expense.e2e-spec.ts`; integration `flows.int-spec.ts` (c/c2) +
  `rls-isolation.int-spec.ts`; **UI** `e2e/tests/02-decisions.spec.ts` (Globex).

### 5.2 Postgres RLS at the database (the last line of defense)
- **Actor:** the long-running API connecting as the **unprivileged** `*_app` role.
- **Steps:** with `app.current_tenant` set to Acme, query tenant-scoped tables.
- **Expected result:** the runtime role is confirmed `NOSUPERUSER`/`NOBYPASSRLS`;
  an Acme context returns **no** Globex rows in `org_units`/`roles`/
  `role_assignments`/`expenses`; a direct id probe for a Globex row returns nothing.
- **Design:** [§6](./DESIGN.md#s6), [§8.3 why Postgres / RLS](./DESIGN.md#s8-3).
- **Tested:** unit `tenant-context`/`rls.interceptor`; integration
  `rls-isolation.int-spec.ts` (3 checks against real Postgres).

---

## 6. Admin CRUD (PAP / FR-10 tenant self-service)

### 6.1 Manage tenants, org-units, permissions, roles, assignments, policies
- **Actor:** Dev (`org_admin`) / a tenant admin, through the PAP (via the gateway).
- **Steps:** create/read tenants; build the org-unit hierarchy and move subtrees;
  manage the global permission catalog; create roles and grant/revoke permissions;
  assign/revoke roles to users at a scope; publish/activate/rollback policies. Every
  write is tenant-scoped by RLS (except global `tenants`/`permissions`).
- **Expected result:** consistent CRUD with the §8.1 envelope on errors,
  optimistic-concurrency on updates, and RLS preventing cross-tenant reads/writes.
- **Design:** [§8 APIs/data](./DESIGN.md#s8), FR-10 [§2.1](./DESIGN.md#s2), the PAP
  module table in [apps/authz-admin/README.md](./apps/authz-admin/README.md).
- **Tested:** unit — per-aggregate `*.use-case.spec.ts` (tenant, org-unit,
  permission, role, role-assignment, policy, principal); e2e — `tenant`,
  `org-unit`, `permission`, `role`, `role-assignment`, `policy`, `principal`
  `.e2e-spec.ts`; integration — seeded + exercised by `flows.int-spec.ts`; **UI** —
  `e2e/tests/04-dynamic-fr8.spec.ts` drives the Admin screen's grant/revoke.

---

## 7. Service-to-service re-authentication (FR-7)

### 7.1 Each hop re-evaluates the original principal with a signed internal token
- **Actor:** the gateway → the expense PEP (and the PEP → the PIP/PDP/audit).
- **Steps:** the gateway verifies the end-user JWT, **mints a signed internal
  identity token** (HS256/token-exchange RFC 8693), **strips every client-spoofable
  identity header** and injects the server-derived `x-internal-identity` /
  `x-tenant-id` / `x-actor-id`. The PEP reads that token and **re-resolves the
  principal per request** — it never trusts roles from the caller.
- **Expected result:** every protected hop re-authorizes from verified context; the
  original principal is re-evaluated at each service, not assumed.
- **Design:** [§7 service-to-service security](./DESIGN.md#s7), D6 [§12](./DESIGN.md#s12),
  FR-7 [§2.1](./DESIGN.md#s2).
- **Tested:** unit `hmac-internal-token-minter`, `identity-context.middleware.spec.ts`;
  e2e `gateway.e2e-spec.ts`, `expense.e2e-spec.ts`; integration
  `gateway-auth.int-spec.ts` + `flows.int-spec.ts`; **UI** `e2e/tests/02` & `04`
  (every approve re-resolves the principal through the chain).

### 7.2 Confused-deputy defense — forged identity/tenant headers are ignored
- **Actor:** a malicious client sending `x-tenant-id: globex` (or a forged
  `x-internal-identity`) while holding an **Acme** token.
- **Steps:** call a protected route through the gateway with the forged headers.
- **Expected result:** the gateway **strips** the client headers and re-derives them
  from the verified JWT, so the request is forwarded as **Acme** —
  `x-platform-admin` is stripped unconditionally (privilege elevation is a verified
  claim, never a client header).
- **Design:** [§7](./DESIGN.md#s7), [§10](./DESIGN.md#s10).
- **Tested:** unit `header-contract.spec.ts`, `forwarded-headers.spec.ts`; e2e
  `gateway.e2e-spec.ts` ("ignores forged x-tenant-id"); integration
  `gateway-auth.int-spec.ts` ("IGNORES a forged x-tenant-id / x-internal-identity").

---

## 8. Audit (FR-9)

### 8.1 Every decision (allow **and** deny) is recorded in a tamper-evident chain
- **Actor:** the PEPs (and the PAP for admin changes), then a compliance reader.
- **Steps:** after every enforced check the PEP posts a `DecisionAuditRecord` to the
  Audit service, which appends it to a per-record **hash chain**
  (`record_hash = sha256(prev_hash || canonical(event))`, genesis = 64 zeros) in a
  `SERIALIZABLE` transaction, with an append-only DB trigger. A reader lists
  `GET /v1/audit/events?tenantId=…` and replays `GET /v1/audit/events/verify`.
- **Expected result:** both an ALLOW and a DENY entry appear with reason +
  `decisionId`; `verify` reports `{valid:true, brokenAt:null}`; any edit, delete or
  reorder breaks the chain and `verify` pinpoints the first broken `seq`.
- **Design:** [§10 security & compliance](./DESIGN.md#s10), [Appendix C audit](./DESIGN.md#app-c),
  [§8.7](./DESIGN.md#L501), FR-9 [§2.1](./DESIGN.md#s2).
- **Tested:** unit `hash-chain.spec.ts`, `record-audit-event.use-case.spec.ts`,
  `verify-chain.use-case.spec.ts`; e2e `audit-event.e2e-spec.ts`; integration
  `flows.int-spec.ts` ("audits every decision … and the chain verifies"); **UI**
  `e2e/tests/05-audit.spec.ts` (decision-log panel shows a real ALLOW + DENY).

---

## 9. The security-UX case (intentional)

### 9.1 Hiding a button is UX, not the security gate
- **Actor:** Sam (`engineer`), who will be denied.
- **Steps:** on the Expenses screen the **Approve button is rendered and enabled
  even for Sam** (the UI deliberately does not hide it). Sam clicks it →
  `POST /v1/expenses/exp_42/approve` hits the PEP.
- **Expected result:** the server returns a real **403**; the SPA shows the DENY
  block. This proves the **PEP/PDP is the gate** — the client is never the security
  boundary, and a UI that simply hid the button would be hiding, not enforcing.
  (Reinforced by the SPA keeping the JWT in memory, never `localStorage`.)
- **Design:** [§13 reference implementation — security note](./DESIGN.md#L619),
  [§7](./DESIGN.md#s7).
- **Tested:** principle enforced server-side in e2e `expense.e2e-spec.ts`;
  integration `flows.int-spec.ts` (d); **UI** `e2e/tests/06-security-ux.spec.ts`
  (button visible + enabled → click → server 403).

---

## Flow → FR coverage

| Flow | FR | Primary DESIGN § |
|---|---|---|
| 1. Authentication | FR-2 | [§5](./DESIGN.md#s5), [§7](./DESIGN.md#s7) |
| 2. Authorization decisions | FR-5, FR-6 | [§3](./DESIGN.md#s3), [§4.3](./DESIGN.md#s4) |
| 3. RBAC + inheritance | FR-3, FR-4 | [§3](./DESIGN.md#s3), [§3.5](./DESIGN.md#s3-5) |
| 4. Dynamic role/policy mgmt | FR-8 | [§3.4](./DESIGN.md#s3-4) |
| 5. Tenant isolation | FR-1 | [§6](./DESIGN.md#s6) |
| 6. Admin CRUD | FR-10 | [§8](./DESIGN.md#s8) |
| 7. Service-to-service re-auth | FR-7 | [§7](./DESIGN.md#s7) |
| 8. Audit | FR-9 | [§10](./DESIGN.md#s10), [App. C](./DESIGN.md#app-c) |
| 9. Security-UX | — (design principle) | [§13](./DESIGN.md#L619) |

The same flows, broken down by which **test tier** proves each, are in the
[customer-flow → test mapping table in TESTING.md](./TESTING.md#customer-flow--test-mapping).
