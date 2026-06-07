# API Playbook

Drive the whole authorization platform end-to-end. **Pick one:**

- 🟢 **[Option A — Postman (easiest)](#opt-postman):** import the collection and click **Run**. It logs in, captures tokens, and runs every flow with pass/fail assertions — no other setup.
- 🧰 **[Option B — curl (manual)](#opt-curl):** copy-paste the recipes below; every request is verified against the live stack.
- 🔎 **Bonus — Swagger UI:** click through in the browser at `http://localhost:8080/docs` (Authorize with a token from §1).

- **Design contracts:** [DESIGN.md §8](./DESIGN.md#s8) · **Customer flows:** [CUSTOMER_FLOWS.md](./CUSTOMER_FLOWS.md) · **Run the stack:** [RUNNING.md](./RUNNING.md)

---

## 0. Prerequisites

Bring the stack up and seed it ([RUNNING.md](./RUNNING.md)):

```bash
docker compose up -d && ./scripts/bootstrap.sh
# If a local Postgres holds :5432 (e.g. a Homebrew postgres or another container):
#   PG_HOST_PORT=5544 docker compose up -d && PG_PORT=5544 ./scripts/bootstrap.sh
# (The app ports below never change — only Postgres' host port does.)
```

> Run the recipes on a **freshly-bootstrapped** stack so `exp_42` is `pending` and the ALLOW recipe returns a clean `200` (re-approving an already-approved expense correctly returns `409`).

| Service | URL | Role |
|---|---|---|
| **Identity** (IdP) | `http://localhost:3200` | issues JWTs |
| **API Gateway** | `http://localhost:8080` | the only public entry — validates JWT, mints the signed internal token, routes |
| Demo UI | `http://localhost:8081` | clickable demo |

```bash
export IDP=http://localhost:3200
export GW=http://localhost:8080
```

### Conventions
- **Auth:** gateway calls carry `Authorization: Bearer <accessToken>`. The token holds **identity + tenant only** — *no permissions* (resolved per request, so a revocation takes effect without waiting for the token to expire).
- **List endpoints are cursor-paginated:** `{ "items": [...], "nextCursor": null, "hasMore": false }`. The recipes use `(.items // .)[]` so they work whether a route returns `{items}` or a bare array.
- **Error envelope** (4xx/5xx): `{ "error": { "code", "message", "reason", "decisionId?", "traceId" } }`.
- **Platform-admin** surfaces (tenant lifecycle, the global permission catalog, role grant/revoke) require a platform-admin token — here, **Dev**. Non-admins get `403`.
- **Seeded users** (password `Password123!`): `riya@acme.com` (finance_manager), `sam@acme.com` (engineer), `dev@acme.com` (org_admin / platform-admin).

---

<a id="opt-postman"></a>
## Option A — Postman (easiest)

~30 seconds, no setup beyond import:

1. **Import** both files from [`postman/`](./postman/) — in Postman, *Import* → drag both in:
   - `postman/authz-platform.postman_collection.json`
   - `postman/authz-platform.postman_environment.json`
2. **Select** the **Authz Platform (local)** environment (top-right dropdown).
3. Make sure the stack is up ([§0 Prerequisites](#0-prerequisites)).
4. **Run the runner:** on the collection, **⋯ → Run**, then **Run Authz Platform**. The Collection Runner fires all 23 requests in order; the **0. Auth** folder logs in and captures the tokens, so every later request is pre-authorized.
5. Every request asserts its expected result — login `200` · ALLOW `200` · ABAC `403` · isolation `404` · RBAC `403` · admin `201`/`403` · FR-8 revoke→deny→re-grant · policy publish `201` — all green.

> Prefer clicking individual requests? Run **0. Auth → Login as Riya / Dev / Sam** once, then fire any request. (Re-bootstrap the stack for a clean `200` on the ALLOW case — re-approving an already-approved expense returns `409`.)

The collection mirrors the curl recipes below 1:1 and already sets `content-type: application/json` on every call.

<a id="opt-curl"></a>
## Option B — curl (manual)

The numbered sections below (§1 onward) are copy-paste `curl`. A **Swagger UI** is also live if you prefer clicking — open it and hit **Authorize** with a `Bearer <accessToken>` from §1:

| Swagger UI | OpenAPI JSON |
|---|---|
| Gateway (public entry): `http://localhost:8080/docs` | `http://localhost:8080/docs-json` |
| Identity (login/JWKS): `http://localhost:3200/docs` | `http://localhost:3200/docs-json` |
| Expense (PEP): `http://localhost:3300/docs` | `http://localhost:3300/docs-json` |

*(Authorization Admin and Audit are internal-only — reach them through the gateway.)*

---

## 1. Authenticate

```bash
export RIYA=$(curl -sS -X POST $IDP/v1/auth/token -H 'content-type: application/json' \
  -d '{"email":"riya@acme.com","password":"Password123!"}' | jq -r .accessToken)
export DEV=$(curl -sS -X POST $IDP/v1/auth/token -H 'content-type: application/json' \
  -d '{"email":"dev@acme.com","password":"Password123!"}' | jq -r .accessToken)
export SAM=$(curl -sS -X POST $IDP/v1/auth/token -H 'content-type: application/json' \
  -d '{"email":"sam@acme.com","password":"Password123!"}' | jq -r .accessToken)
export RIYA_SUB=$(curl -sS -X POST $IDP/v1/auth/token -H 'content-type: application/json' \
  -d '{"email":"riya@acme.com","password":"Password123!"}' | jq -r .sub)
```
Response: `{ "accessToken", "tokenType":"Bearer", "expiresIn":900, "refreshToken", "sub", "tid", "sid" }`.
Claims are `sub`/`tid`/`sid`/`act`/`iss`/`aud`/`iat`/`exp` — **no permissions** (DESIGN D4).

Bad credentials → `401`:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $IDP/v1/auth/token \
  -H 'content-type: application/json' -d '{"email":"riya@acme.com","password":"wrong"}'   # 401
```

---

## 2. The authorization decisions (the core)

```bash
# Expenses Riya can see (tenant-scoped)
curl -sS $GW/v1/expenses -H "authorization: Bearer $RIYA" | jq -c '(.items // .)[] | {id,amount,department,status}'

# ✅ ALLOW — $8,500 same-dept → 200
curl -sS -X POST $GW/v1/expenses/exp_42/approve \
  -H "authorization: Bearer $RIYA" -H 'content-type: application/json' -d '{}' | jq
# { "id":"exp_42", "status":"approved", "approvedBy":"…", "decisionId":"dec_…" }

# ❌ DENY (ABAC amount<10000) — $25,000 → 403
curl -sS -X POST $GW/v1/expenses/exp_99/approve \
  -H "authorization: Bearer $RIYA" -H 'content-type: application/json' -d '{}' | jq .error
# { "code":"forbidden", "reason":"denied by expense_report/acme.finance", "decisionId":"dec_…", … }

# ❌ DENY (RBAC) — Sam (engineer) → 403
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $GW/v1/expenses/exp_42/approve \
  -H "authorization: Bearer $SAM" -H 'content-type: application/json' -d '{}'   # 403
```

---

## 3. Tenant isolation

Riya (Acme) can't even see a Globex resource — Postgres RLS hides it, so the PEP loads nothing → **404** (the strongest guardrail; it won't confirm the row exists):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $GW/v1/expenses/exp_glx/approve \
  -H "authorization: Bearer $RIYA" -H 'content-type: application/json' -d '{}'   # 404
```
The same holds across admin reads — an Acme admin's `/v1/roles`, `/v1/role-assignments`, `/v1/policies` only ever return Acme rows.

---

## 4. IAM — read the model (PAP)

```bash
curl -sS $GW/v1/roles        -H "authorization: Bearer $DEV" | jq -c '(.items // .)[] | {key,scope,permissions}'
curl -sS $GW/v1/permissions  -H "authorization: Bearer $DEV" | jq -c '(.items // .)[] | {key,description}'
curl -sS $GW/v1/org-units    -H "authorization: Bearer $DEV" | jq -c '(.items // .)[] | {path,name}'
curl -sS "$GW/v1/role-assignments?userId=$RIYA_SUB" -H "authorization: Bearer $DEV" \
  | jq -c '.items[] | {id,roleId,scope,status,version}'
```

## 5. IAM — manage roles & permissions (platform-admin = Dev)

```bash
# Create a global-catalog permission (key = service:resource:action)
curl -sS -X POST $GW/v1/permissions -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d '{"key":"expense:report:export","description":"Export expense reports"}' | jq -c '{id,key}'    # 201

# Create a tenant role scoped to an org node, bound to permissions
curl -sS -X POST $GW/v1/roles -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d '{"key":"finance_auditor","scope":"acme.finance","permissions":["expense:report:read","expense:report:export"]}' \
  | jq -c '{id,key,scope}'                                                                           # 201

# Assign a role at a scope (delegatedBy is stamped server-side, never from the body)
FM_ID=$(curl -sS $GW/v1/roles -H "authorization: Bearer $DEV" | jq -r '(.items // .)[]|select(.key=="finance_manager").id')
curl -sS -X POST $GW/v1/role-assignments -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d "{\"userId\":\"$RIYA_SUB\",\"roleId\":\"$FM_ID\",\"scope\":\"acme.finance\"}" | jq -c '{id,status}'  # 201

# A non-admin write is refused:
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $GW/v1/permissions -H "authorization: Bearer $RIYA" \
  -H 'content-type: application/json' -d '{"key":"x:y:z","description":"t"}'                          # 403
```

## 6. Dynamic role management — the FR-8 live flip

Revoke Riya's `finance_manager`; the *same* approve flips to deny within seconds (no redeploy, no token wait), then re-grant to restore.

```bash
# 1) Find her finance_manager assignment id + version
read ASG_ID ASG_VER < <(curl -sS "$GW/v1/role-assignments?userId=$RIYA_SUB" -H "authorization: Bearer $DEV" \
  | jq -r '.items[] | select(.status=="active" and (.roleId|endswith("0001"))) | "\(.id) \(.version)"' | head -1)

# 2) Revoke (platform-admin; optimistic concurrency via If-Match; emits RoleAssignmentRevoked)
curl -sS -o /dev/null -w "revoke: %{http_code}\n" -X POST $GW/v1/role-assignments/$ASG_ID/revoke \
  -H "authorization: Bearer $DEV" -H "if-match: \"$ASG_VER\"" -H 'content-type: application/json' -d '{}'   # 200

# 3) Riya approves → now DENIED (role gone)
curl -sS -o /dev/null -w "approve after revoke: %{http_code}\n" -X POST $GW/v1/expenses/exp_42/approve \
  -H "authorization: Bearer $RIYA" -H 'content-type: application/json' -d '{}'                              # 403

# 4) Re-grant to restore
FM_ID=$(curl -sS $GW/v1/roles -H "authorization: Bearer $DEV" | jq -r '(.items // .)[]|select(.key=="finance_manager").id')
curl -sS -o /dev/null -w "re-grant: %{http_code}\n" -X POST $GW/v1/role-assignments \
  -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d "{\"userId\":\"$RIYA_SUB\",\"roleId\":\"$FM_ID\",\"scope\":\"acme.finance\"}"                          # 201
```

## 7. Dynamic policy management — rules defined at runtime, never hardcoded

```bash
# Inspect the published policy for acme.finance (rule is versioned JSON)
curl -sS $GW/v1/policies -H "authorization: Bearer $DEV" | jq -c '(.items // .)[] | {scope,version,status}'

# Publish a new version (note the rule carries "resource"; version auto-increments)
curl -sS -X POST $GW/v1/policies -H "authorization: Bearer $DEV" -H 'content-type: application/json' -d '{
  "scope":"acme.finance",
  "rule":{"resource":"expense_report","rules":[{"name":"fm_approve","roles":["finance_manager"],
    "effect":"ALLOW","actions":["read","approve"],
    "condition":{"all":[{"expr":"request.resource.attr.amount < 10000"},
                        {"expr":"request.resource.attr.department == request.principal.attr.department"}]}}]},
  "effectiveDate":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' | jq -c '{id,scope,version,status}'                                                                # 201

# Roll back to a prior version (creates a new version restoring it)
# POL_ID=<id from the list>; curl -sS -X POST $GW/v1/policies/$POL_ID/rollback \
#   -H "authorization: Bearer $DEV" -H 'content-type: application/json' -d '{"toVersion":1}'
```

---

## Notes
- **The decision API is internal.** Services call the co-located Cerbos PDP over the mesh (the `/pdp/v1/check` shape in DESIGN §8.2); it is never exposed at the public gateway. You exercise it through the business endpoints.
- **Audit.** Every decision (allow *and* deny) + admin change is written to a tamper-evident hash-chained log, linked by `decisionId`/`traceId`.
- **Idempotency & concurrency.** Mutations accept `Idempotency-Key`; updates use `If-Match` optimistic concurrency (see §6).
- **Service-to-service.** Internal calls carry mTLS workload identity + a signed internal token; the callee re-authorizes for the original principal (defeats confused-deputy, DESIGN §7).
