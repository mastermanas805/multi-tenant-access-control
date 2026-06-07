# API Gateway — NestJS

The **authentication edge** for the multi-tenant access-control platform
(DESIGN §4.1, §4.3, §4.4, §5, §7). It is the single client entrypoint: it
validates the end-user **JWT against the Identity JWKS**, **rate-limits**, mints a
**signed internal identity token**, and **reverse-proxies** to the downstream
services — re-deriving the caller's identity/tenant from the verified JWT on every
request and **overwriting any client-sent identity headers** (confused-deputy
defense, §7). The gateway does **authN only** — authorization is each service's
PEP (§4.4).

Same hexagonal conventions as `authz-admin` / `identity` (domain → application →
infrastructure → presentation), kernel base classes, the §8.1 error envelope,
typed/validated config, Swagger at `/docs`, terminus health, strict
`ValidationPipe`. Like `identity`, it is **stateless and DB-free** — no Postgres /
RLS / tenant guard. The domain layer (route table, header policy, rate limiter,
token value objects + ports) imports nothing framework-specific.

## What every request goes through

1. **Trace id** — `RequestContextMiddleware` mints/echoes `x-trace-id` (the
   correlation id flows downstream and into the §8.1 envelope).
2. **Rate limit** — a dependency-free fixed-window limiter, applied **before**
   auth so an unauthenticated flood is shed cheaply (429 + `Retry-After`).
3. **AuthN** — the route-aware `JwtAuthGuard` verifies the inbound RS256 JWT
   against the Identity JWKS (signature + `iss`/`aud`/`exp`/`nbf`, with clock
   skew) for **protected** routes and attaches the trusted identity to
   `req.identity`. Public routes (`/auth/*`) pass through with no token.
4. **Proxy** — the route table resolves the upstream; for protected routes the
   gateway mints the signed internal token, **strips every client-spoofable
   identity/context header**, injects the server-derived ones, and forwards. The
   upstream's response (any status/body) is streamed back **verbatim** so service
   §8.1 envelopes (e.g. a PEP 403 with `reason` + `decisionId`) survive intact.

## Routing (DESIGN §4.1)

| Path | Upstream | Auth |
| --- | --- | --- |
| `/auth/*` | identity | public (login/refresh — no token yet) |
| `/v1/expenses`, `/v1/expenses/*` | expense | required |
| `/v1/{tenants,org-units,roles,permissions,role-assignments,policies}[/*]` | authz-admin | required |
| `/admin/*` | authz-admin | required |
| `/health`, `/docs` | gateway-local | none |

Anything else returns a clean edge **404** — an unknown `/v1/<x>` is never
silently forwarded anywhere. The matcher is anchored on path-segment boundaries,
so `/v1/expensesX` does **not** match `/v1/expenses` (route-smuggling defense).

## Identity headers injected downstream

For an authenticated forward the gateway sets, **derived only from the verified
JWT** (never from client input):

| Header | Value | Consumed by |
| --- | --- | --- |
| `x-internal-identity` | base64url(JSON(`InternalIdentityToken`)) | `@authz/pep` `IdentityContextMiddleware` |
| `x-internal-identity-signature` | HS256 JWS over the same claims (token-exchange, RFC 8693) | the PEP once its `verifyToken` is upgraded from the placeholder decode to signature verification |
| `x-tenant-id` | verified `tid` | authz-admin `TenantContextGuard` |
| `x-actor-id` | verified `act` (= `sub` for a direct login) | authz-admin `TenantContextGuard` |

The token carries **identity + tenant only — no roles/permissions** (D4); the
PEP resolves effective roles per-request from the PIP.

## Never trust client identity headers (DESIGN §7)

Inbound `x-internal-identity`, `x-internal-identity-signature`, `x-tenant-id`,
`x-actor-id` and `x-platform-admin` are **always stripped** and (for protected
routes) re-derived/overwritten from the verified JWT. A client that sends
`x-tenant-id: globex` while holding an `acme` token is forwarded as `acme`. This
is covered by both unit and e2e tests.

## Quick start (Docker)

From the **repository root**. The gateway depends on `identity`, `authz-admin` and
`expense`, so it is exercised as part of the whole stack:

```bash
docker compose up -d --build      # whole stack
./scripts/bootstrap.sh            # migrate + seed + publish the demo policy
open http://localhost:8080/docs
```

The gateway is stateless and DB-free (no migration of its own). For the end-to-end
demo through the gateway (login → ALLOW/DENY → audit), see **[RUNNING.md](../../RUNNING.md)**.

## Running on the host

```bash
pnpm install                                  # from the repo root
pnpm --filter @app/gateway run start:dev      # http://localhost:8080/docs
```

Point `IDENTITY_JWKS_URL` / `IDENTITY_ISSUER` / `*_URL` at your local services
(see `.env.example`).

## Try it (end to end through the platform)

```bash
# 1. Get a user token from the IdP (through the gateway's public /auth/* route).
TOKEN=$(curl -s http://localhost:8080/auth/token -H 'content-type: application/json' \
  -d '{"email":"riya@acme.com","password":"Password123!"}' | jq -r .accessToken)

# 2. Call a protected route — the gateway verifies the JWT, mints the internal
#    token, and proxies to the expense service's PEP.
curl -si http://localhost:8080/v1/expenses -H "authorization: Bearer $TOKEN" | head -n1

# 3. Missing token -> 401 + §8.1 envelope.
curl -si http://localhost:8080/v1/expenses | tail -n1 | jq

# 4. A FORGED x-tenant-id is ignored — overwritten with the verified tenant.
curl -si http://localhost:8080/v1/expenses -H "authorization: Bearer $TOKEN" \
  -H 'x-tenant-id: globex' | head -n1
```

## Security properties (DESIGN §7, §10)

- **RS256 verification only:** the verifier rejects `alg:none` and HS/EC
  confusion; it looks the key up by `kid` against the cached JWKS and verifies the
  signature with Node `crypto` (no external JWT library). Fail-closed (D8): a
  JWKS it cannot fetch means no token verifies.
- **Generic 401:** missing / wrong-scheme / malformed / bad-signature / expired
  all surface the same message — no auth oracle.
- **Confused-deputy defense:** client identity/context headers are stripped and
  re-derived from the verified JWT; `x-platform-admin` is stripped unconditionally
  (privilege elevation is a verified-claim decision, not a client header).
- **Signed internal token:** the propagated context is signed, not a forgeable
  plaintext header (OWASP "Passport" / token-exchange RFC 8693).
- **Rate limiting + helmet:** edge DoS protection and security headers.
- **Verbatim upstream errors:** the gateway never rewrites a service's §8.1
  envelope; only a true proxy-hop failure becomes a gateway 502/504.

## Config (typed + validated; see `.env.example`)

`PORT`, `IDENTITY_JWKS_URL`, `IDENTITY_ISSUER`, `IDENTITY_AUDIENCE`,
`JWKS_CACHE_TTL_SECONDS`, `JWT_CLOCK_TOLERANCE_SECONDS`, `INTERNAL_TOKEN_SECRET`
(**DEV default — override in prod**), `INTERNAL_TOKEN_KID/ISSUER/TTL_SECONDS`,
`IDENTITY_URL`, `AUTHZ_ADMIN_URL`, `EXPENSE_URL`, `UPSTREAM_TIMEOUT_MS`,
`RATE_LIMIT_*`. An invalid environment fails fast at boot.

## Scripts

| Script | Purpose |
| --- | --- |
| `build` / `typecheck` | `tsc -b` the app |
| `start` / `start:dev` | run compiled / ts-node-dev |
| `test` / `test:e2e` | unit (jest) / e2e (boots the real `AppModule`) |
