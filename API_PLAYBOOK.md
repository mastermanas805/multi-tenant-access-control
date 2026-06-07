# API Playbook — one story, end to end

This drives the **whole platform** as a single narrative an interviewer can follow top to bottom:

> **onboard a client → provision its access model *through the API* → sign in → a happy-path decision → escalating denials → a second, fully-isolated client → flip a role live → version a policy.**

Every role and every policy you see is **created at runtime through the API and stored in the database — nothing is hardcoded** ([DESIGN §8.7](./DESIGN.md#s8)). The same story runs two ways; pick one:

- 🟢 **[Postman runner](#run-it-in-postman) (easiest):** import two files, click **Run**. It executes the whole story in order with pass/fail assertions.
- 🧰 **[curl](#the-story-in-curl) (copy-paste):** the numbered acts below. Every request was verified against the live stack.
- 🔎 **Swagger UI:** browse/try at `http://localhost:8080/docs` (Authorize with a token from Act 1).

**See also:** [DESIGN.md §8](./DESIGN.md#s8) (API & data contracts) · [CUSTOMER_FLOWS.md](./CUSTOMER_FLOWS.md) · [RUNNING.md](./RUNNING.md).

---

## 0. Setup & the cast

Bring the stack up and seed it — run on a **freshly-bootstrapped** stack so the demo expenses are `pending`:

```bash
docker compose up -d && ./scripts/bootstrap.sh
# If a local Postgres holds :5432 (Homebrew/another container), only Postgres' host port moves:
#   PG_HOST_PORT=5544 docker compose up -d && PG_PORT=5544 ./scripts/bootstrap.sh
```

```bash
export IDP=http://localhost:3200      # Identity (IdP) — issues JWTs
export GW=http://localhost:8080       # API Gateway — the ONLY public entry; validates JWT, mints the signed internal token, routes
```

**Two tenants are seeded, so isolation is real — not a single-tenant toy.** Password for everyone: `Password123!`.

| Client | Tenant id | Users (email) | Role |
|---|---|---|---|
| **Acme** (pool tier) | `aaaaaaaa-…-000000000001` | `dev@acme.com` | org admin / **platform-admin** |
| | | `riya@acme.com` | **finance_manager** @ `acme.finance` |
| | | `sam@acme.com` | engineer @ `acme` |
| **Globex** (silo tier) | `bbbbbbbb-…-000000000002` | `gus@globex.com` | Globex admin / **platform-admin** |
| | | `gwen@globex.com` | **ops_manager** @ `globex.ops` |

Demo expenses (each carries an `amount`, `department`, and org `scope`):

| Expense | Tenant | Amount | Dept / scope | Used for |
|---|---|---|---|---|
| `exp_42` | Acme | $8,500 | finance / `acme.finance` | happy-path **ALLOW** |
| `exp_43` | Acme | $1,200 | finance / `acme.finance` | FR-8 live role-flip |
| `exp_99` | Acme | $25,000 | finance / `acme.finance` | **DENY** (amount cap) |
| `exp_gx1` | Globex | $3,200 | ops / `globex.ops` | Globex **ALLOW** |
| `exp_gx2` | Globex | $42,000 | ops / `globex.ops` | Globex **DENY** (amount cap) |
| `exp_glx` | Globex | $4,200 | ops / `globex` | cross-tenant isolation |

**Conventions.** Gateway calls carry `Authorization: Bearer <accessToken>`. The token holds **identity + tenant only — no permissions** (resolved per request, so a revoke takes effect immediately, not when the token expires — [D4](./DESIGN.md#s5)). List endpoints are cursor-paginated (`{items, nextCursor, hasMore}`) — recipes use `(.items // .)[]`. Errors use one envelope: `{ "error": { code, message, reason?, decisionId?, traceId } }`.

---

## The story in curl

### Act 1 — Authenticate

The IdP issues an RS256 JWT for a password grant. Capture a token (and `sub`) per persona:

```bash
login() { curl -sS -X POST $IDP/v1/auth/token -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"Password123!\"}"; }

DEV=$(login dev@acme.com   | jq -r .accessToken)   # Acme platform-admin
RIYA=$(login riya@acme.com | jq -r .accessToken)   # Acme finance_manager
SAM=$(login sam@acme.com   | jq -r .accessToken)   # Acme engineer
GUS=$(login gus@globex.com | jq -r .accessToken)   # Globex platform-admin
GWEN=$(login gwen@globex.com | jq -r .accessToken) # Globex ops_manager
RIYA_SUB=$(login riya@acme.com | jq -r .sub)
SAM_SUB=$(login sam@acme.com  | jq -r .sub)
```

Response: `{ accessToken, tokenType:"Bearer", expiresIn:900, refreshToken, sub, tid, sid }`. Claims are `sub/tid/sid/act/iss/aud/iat/exp` — **no roles, no permissions**.

```bash
# Bad credentials -> 401 (generic message; no account enumeration)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $IDP/v1/auth/token \
  -H 'content-type: application/json' -d '{"email":"riya@acme.com","password":"wrong"}'   # 401
```

### Act 2 — Onboard a new client (tenant)

Tenant lifecycle is an API, gated to **platform-admins**:

```bash
# Dev (platform-admin) onboards a new client -> 201
curl -sS -X POST $GW/v1/tenants -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d '{"name":"Initech","slug":"initech-001","isolationTier":"pool"}' | jq -c '{id,name,slug,status,isolationTier}'

# A non-admin (Riya) is refused -> 403
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $GW/v1/tenants -H "authorization: Bearer $RIYA" \
  -H 'content-type: application/json' -d '{"name":"X","slug":"x-co"}'                       # 403
```

> **Provisioning a brand-new tenant's *model* (org/roles/policies) is done by signing in as *that tenant's* admin** — every write is scoped by the caller's verified `tid`, so a platform-admin can never write into another tenant's data (confused-deputy defense, [§7](./DESIGN.md#s7)). The two demoable clients (Acme, Globex) ship with their admins seeded, so we provision against them next. (Identity here has no self-serve sign-up endpoint — users are provisioned out-of-band; the seed stands in for that.)

### Act 3 — Provision an access model *through the API* (nothing hardcoded)

Build a brand-new capability for Acme entirely via the API — catalog a permission, define a role bound to it, grant it to a user, then publish the rule that governs the decision. Dev is Acme's platform-admin.

```bash
# 1) Register a permission in the global catalog  (key = service:resource:action)
curl -sS -X POST $GW/v1/permissions -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d '{"key":"expense:report:export","description":"Export expense reports"}' | jq -c '{id,key}'        # 201 (409 if re-run)

# 2) Define a tenant role at an org scope, bound to permissions
curl -sS -X POST $GW/v1/roles -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d '{"key":"finance_auditor","scope":"acme.finance","permissions":["expense:report:read","expense:report:export"]}' \
  | jq -c '{id,key,scope,permissions}'                                                                   # 201 (409 if re-run)

# 3) Grant the role to Sam at that scope (delegatedBy is stamped server-side, never from the body)
AUDITOR_ID=$(curl -sS $GW/v1/roles -H "authorization: Bearer $DEV" | jq -r '(.items // .)[]|select(.key=="finance_auditor").id')
curl -sS -X POST $GW/v1/role-assignments -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d "{\"userId\":\"$SAM_SUB\",\"roleId\":\"$AUDITOR_ID\",\"scope\":\"acme.finance\"}" | jq -c '{id,status}'  # 201 (409)

# 4) Publish the RULE that drives the decision (DB-backed jsonb; compiled to the PDP). This is the
#    finance_manager approve rule the next act exercises: same-department AND amount < 10000.
curl -sS -X POST $GW/v1/policies -H "authorization: Bearer $DEV" -H 'content-type: application/json' -d '{
  "scope":"acme.finance",
  "effectiveDate":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
  "rule":{"resource":"expense_report","rules":[{"name":"fm_approve","roles":["finance_manager"],
    "effect":"ALLOW","actions":["read","approve"],
    "condition":{"all":[{"expr":"request.resource.attr.amount < 10000"},
                        {"expr":"request.resource.attr.department == request.principal.attr.department"}]}}]}
}' | jq -c '{id,scope,version,status}'                                                                   # 201

# Read the model back — it's all data:
curl -sS $GW/v1/roles    -H "authorization: Bearer $DEV" | jq -c '(.items // .)[] | {key,scope,permissions}'
curl -sS $GW/v1/policies -H "authorization: Bearer $DEV" | jq -c '(.items // .)[] | {scope,version,status}'
```

> **How a published policy reaches the engine.** The PAP compiles the DB rule into a scoped Cerbos policy. On **Linux/CI** Cerbos hot-reloads it automatically; on **macOS Docker Desktop** the file-watch can't cross the VM bind-mount, so `bootstrap.sh` loads published policies with a one-time Cerbos restart. Either way the rule is **runtime-defined and DB-backed, never compiled into a service**. The decisions below run against the rule the bootstrap already made effective; **Act 7 (FR-8)** is the zero-reload live proof — it flips a decision in-process with no policy reload at all.

### Act 4 — The happy path (a real decision)

Riya is a `finance_manager` in Acme's finance org. She lists what she can act on (the list is **authorization-aware** — it returns only rows she's allowed to touch), then approves a same-department expense under the cap:

```bash
curl -sS $GW/v1/expenses -H "authorization: Bearer $RIYA" | jq -c '(.items // .)[] | {id,amount,department,status}'

# ✅ ALLOW — $8,500, same department, under $10k -> 200
curl -sS -X POST $GW/v1/expenses/exp_42/approve \
  -H "authorization: Bearer $RIYA" -H 'content-type: application/json' -d '{}' | jq '{id,status,decisionId}'
# { "id":"exp_42", "status":"approved", "decisionId":"dec_…" }
```

### Act 5 — The tweaks (escalating denials, each a different control)

Same user, same endpoint — only the request changes, and a *different* layer says no each time:

```bash
# ❌ ABAC amount cap — $25,000 fails `amount < 10000` -> 403 (with reason + decisionId)
curl -sS -X POST $GW/v1/expenses/exp_99/approve \
  -H "authorization: Bearer $RIYA" -H 'content-type: application/json' -d '{}' | jq .error
# { "code":"forbidden", "reason":"denied by expense_report/acme.finance", "decisionId":"dec_…", … }

# ❌ RBAC — Sam is an engineer, not a finance_manager -> 403
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $GW/v1/expenses/exp_42/approve \
  -H "authorization: Bearer $SAM" -H 'content-type: application/json' -d '{}'                # 403

# ❌ Tenant isolation — Riya (Acme) reaches for a Globex expense -> 404
#    Postgres RLS hides the row entirely, so the PEP can't even confirm it exists.
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $GW/v1/expenses/exp_glx/approve \
  -H "authorization: Bearer $RIYA" -H 'content-type: application/json' -d '{}'               # 404
```

### Act 6 — A second client, fully isolated, with its *own* runtime policy

Globex is a different company on the same platform. Gwen (Globex `ops_manager`) approves a Globex expense — decided by **Globex's own published policy** (`globex.ops`), not Acme's. Then the same two-way isolation in reverse:

```bash
# ✅ Globex ALLOW — Gwen approves $3,200 ops expense under Globex's own rule -> 200
curl -sS -X POST $GW/v1/expenses/exp_gx1/approve \
  -H "authorization: Bearer $GWEN" -H 'content-type: application/json' -d '{}' | jq '{id,status,decisionId}'

# ❌ Globex DENY — $42,000 fails Globex's amount cap -> 403
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $GW/v1/expenses/exp_gx2/approve \
  -H "authorization: Bearer $GWEN" -H 'content-type: application/json' -d '{}'               # 403

# ❌ Isolation in reverse — Gwen (Globex) reaches for an Acme expense -> 404
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $GW/v1/expenses/exp_42/approve \
  -H "authorization: Bearer $GWEN" -H 'content-type: application/json' -d '{}'               # 404

# Isolation at the ADMIN layer too — Globex's admin sees ONLY Globex roles (RLS), never Acme's.
curl -sS $GW/v1/roles -H "authorization: Bearer $GUS" | jq -c '[(.items // .)[].key]'        # ["ops_manager"]
```

### Act 7 — Flip a role live (FR-8): no redeploy, no token wait

Revoke Riya's `finance_manager` and the *same* approve flips to **deny within the request** — then re-grant and it flips back. (`approve` forces a fresh permission read, so there's no staleness window — [§9.1](./DESIGN.md#s9).) Uses `exp_43` so the happy-path approve didn't consume it:

```bash
# 1) Find her active finance_manager assignment (id + version for optimistic concurrency)
read ASG_ID ASG_VER < <(curl -sS "$GW/v1/role-assignments?userId=$RIYA_SUB" -H "authorization: Bearer $DEV" \
  | jq -r '.items[] | select(.status=="active" and (.roleId|endswith("0001"))) | "\(.id) \(.version)"' | head -1)

# 2) Revoke (platform-admin; If-Match optimistic concurrency; emits RoleAssignmentRevoked) -> 200
curl -sS -o /dev/null -w "revoke: %{http_code}\n" -X POST $GW/v1/role-assignments/$ASG_ID/revoke \
  -H "authorization: Bearer $DEV" -H "if-match: \"$ASG_VER\"" -H 'content-type: application/json' -d '{}'

# 3) Riya approves exp_43 -> now DENIED (role gone) -> 403
curl -sS -o /dev/null -w "approve after revoke: %{http_code}\n" -X POST $GW/v1/expenses/exp_43/approve \
  -H "authorization: Bearer $RIYA" -H 'content-type: application/json' -d '{}'               # 403

# 4) Re-grant finance_manager -> 201
FM_ID=$(curl -sS $GW/v1/roles -H "authorization: Bearer $DEV" | jq -r '(.items // .)[]|select(.key=="finance_manager").id')
curl -sS -o /dev/null -w "re-grant: %{http_code}\n" -X POST $GW/v1/role-assignments \
  -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d "{\"userId\":\"$RIYA_SUB\",\"roleId\":\"$FM_ID\",\"scope\":\"acme.finance\"}"           # 201

# 5) Same approve -> ALLOWED again -> 200 (on a fresh stack; 409 if exp_43 was already approved)
curl -sS -o /dev/null -w "approve after re-grant: %{http_code}\n" -X POST $GW/v1/expenses/exp_43/approve \
  -H "authorization: Bearer $RIYA" -H 'content-type: application/json' -d '{}'               # 200
```

### Act 8 — Version & roll back a policy

Policies are versioned, immutable rows. Publish a new version, list the history, roll back:

```bash
curl -sS $GW/v1/policies -H "authorization: Bearer $DEV" | jq -c '(.items // .)[] | {id,scope,version,status}'

# Publish a new version of the acme.finance rule (version auto-increments) -> 201
curl -sS -X POST $GW/v1/policies -H "authorization: Bearer $DEV" -H 'content-type: application/json' -d '{
  "scope":"acme.finance",
  "effectiveDate":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
  "rule":{"resource":"expense_report","rules":[{"name":"fm_approve","roles":["finance_manager"],
    "effect":"ALLOW","actions":["read","approve"],
    "condition":{"all":[{"expr":"request.resource.attr.amount < 10000"},
                        {"expr":"request.resource.attr.department == request.principal.attr.department"}]}}]}
}' | jq -c '{id,scope,version,status}'                                                       # 201

# Roll a scope back to a prior version (creates a NEW version restoring it):
# POL_ID=<id from the list>
# curl -sS -X POST $GW/v1/policies/$POL_ID/rollback -H "authorization: Bearer $DEV" \
#   -H 'content-type: application/json' -d '{"toVersion":1}'
```

---

## Run it in Postman

The collection runs **the same eight acts** with assertions baked in — about 30 seconds, no setup beyond import:

1. **Import** both files from [`postman/`](./postman/) (*Import* → drag both in):
   - `postman/authz-platform.postman_collection.json`
   - `postman/authz-platform.postman_environment.json`
2. **Select** the **Authz Platform (local)** environment (top-right).
3. Make sure the stack is up and freshly bootstrapped ([Act 0](#0-setup--the-cast)).
4. On the collection, **⋯ → Run**, then **Run**. The folders execute in order:

| Folder | What it proves | Key assertions |
|---|---|---|
| `1 · Authenticate` | password grant for all 5 personas; tokens captured automatically | login `200`; bad creds `401` |
| `2 · Onboard a client` | tenant lifecycle is API + platform-admin gated | Dev `201`; Riya `403` |
| `3 · Provision a model` | permission → role → assignment → **policy**, all via API | each `201` (or `409` on re-run) |
| `4 · Happy path` | a real ALLOW decision | approve `200` (or `409` if already approved) |
| `5 · Tweaks` | amount / RBAC / isolation denials | `403` · `403` · `404` |
| `6 · Second client` | Globex's own policy + two-way isolation | `200` · `403` · `404`; admin sees only `ops_manager` |
| `7 · FR-8 live flip` | revoke → deny → re-grant → allow | `200` · `403` · `201` · `200`/`409` |
| `8 · Policy versions` | publish a new version | list `200`; publish `201` |

> Prefer clicking individual requests? Run **`1 · Authenticate`** once (it captures every token), then fire any request. Re-bootstrap for a pristine run — re-approving an already-approved expense correctly returns `409`.

---

## Swagger UI (browse & try)

| Service | Swagger UI | OpenAPI JSON |
|---|---|---|
| Gateway (public entry) | `http://localhost:8080/docs` | `/docs-json` |
| Identity (login/JWKS) | `http://localhost:3200/docs` | `/docs-json` |
| Expense (PEP) | `http://localhost:3300/docs` | `/docs-json` |

Click **Authorize**, paste `Bearer <accessToken>` from Act 1. *(Authorization Admin and Audit are internal-only — reach them through the gateway.)*

---

## Notes

- **The decision API is internal.** Each service calls its co-located Cerbos PDP over the mesh (`/pdp/v1/check`, [§8.2](./DESIGN.md#s8)); it is never exposed publicly. You exercise it through business endpoints.
- **Everything is audited.** Every decision (allow *and* deny) and every admin change is written to a tamper-evident hash-chained log, linked by `decisionId`/`traceId`.
- **Idempotency & concurrency.** Mutations accept `Idempotency-Key`; updates use `If-Match` optimistic concurrency (Act 7).
- **Service-to-service.** Internal calls carry mTLS workload identity + a signed internal token; the callee re-authorizes for the *original* principal — defeating the confused deputy ([§7](./DESIGN.md#s7)).
