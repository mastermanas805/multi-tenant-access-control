# Identity Service (IdP) — NestJS

The **identity provider** for the multi-tenant access-control platform
(DESIGN §5, §7). A minimal but real OIDC-style IdP: it authenticates seeded demo
users via the OAuth 2.0 **password grant**, issues **RS256-signed JWT** access
tokens plus rotating refresh tokens, and publishes its public key as a **JWKS**
so the gateway and every downstream PEP can verify tokens without a shared secret
or a round-trip to the IdP.

Same hexagonal conventions as `authz-admin` (domain → application →
infrastructure → presentation), kernel base classes, the §8.1 error envelope,
typed/validated config, Swagger at `/docs`, terminus health, strict
`ValidationPipe`. The deliberate difference: it is **stateless and DB-free** —
users and the signing keypair come from config, so there is no Postgres / RLS /
tenant guard here.

## Tokens carry identity + tenant only — never roles (D4)

The minted access token mirrors the `InternalIdentityToken` contract: claims
`sub` (user id), `tid` (active tenant), `sid` (session id), `act` (acting caller
= `sub` for a direct login), plus `iss`/`aud`/`iat`/`exp` (~15m). **No roles or
permissions** — the PEP resolves effective roles per-request from the PIP, so a
revocation is enforced within the staleness bound rather than waiting on token
expiry (DESIGN §5).

## Endpoints

| Method | Route                     | Auth | Purpose                                              |
| ------ | ------------------------- | ---- | ---------------------------------------------------- |
| `POST` | `/v1/auth/token`          | none | Password grant — issue an access + refresh token pair |
| `POST` | `/v1/auth/refresh`        | none | Refresh grant — rotate a refresh token for a new pair |
| `GET`  | `/.well-known/jwks.json`  | none | Public JWKS for RS256 verification (version-neutral) |
| `GET`  | `/health`                 | none | Liveness probe (version-neutral)                     |
| `GET`  | `/docs`                   | none | OpenAPI / Swagger UI                                  |

## Seeded demo users

Defaults (override via `SEED_USERS` JSON). Password for all three is
`Password123!` (a **dev seed** — never ship plaintext credentials in config).

| Email          | Tenant | User id (`sub`)                          |
| -------------- | ------ | ---------------------------------------- |
| `riya@acme.com`| `acme` | `11111111-1111-4111-8111-111111111111`   |
| `sam@acme.com` | `acme` | `22222222-2222-4222-8222-222222222222`   |
| `dev@acme.com` | `acme` | `33333333-3333-4333-8333-333333333333`   |

## Quick start (Docker)

From the **repository root**. Identity is stateless and DB-free, so it needs no
migration/seed — it comes up with `docker compose`:

```bash
docker compose up -d --build identity
open http://localhost:3200/docs        # Swagger (identity listens on :3200)
```

For the full stack + the end-to-end demo (log in here, then call the gateway/PEP),
see **[RUNNING.md](../../RUNNING.md)**.

## Running on the host

```bash
pnpm install                                   # from the repo root
pnpm --filter @app/identity run start:dev      # http://localhost:3100/docs
```

The dev signing keypair under `keys/` loads automatically (see `keys/README.md`).

## Try it

```bash
# 1. Password grant.
curl -s http://localhost:3100/v1/auth/token \
  -H 'content-type: application/json' \
  -d '{"email":"riya@acme.com","password":"Password123!"}' | jq

# 2. Inspect the JWT claims (sub/tid/sid/act, no roles).
TOKEN=$(curl -s http://localhost:3100/v1/auth/token -H 'content-type: application/json' \
  -d '{"email":"riya@acme.com","password":"Password123!"}' | jq -r .accessToken)
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq

# 3. Public JWKS (used by the gateway/PEP to verify the signature above).
curl -s http://localhost:3100/.well-known/jwks.json | jq

# 4. Wrong password -> 401 + §8.1 envelope.
curl -si http://localhost:3100/v1/auth/token -H 'content-type: application/json' \
  -d '{"email":"riya@acme.com","password":"nope"}' | tail -n1 | jq
```

## Signing keys

The committed dev keypair (`keys/dev-*.pem`) is a **development default only** —
see `keys/README.md`. Production injects its own keys via `JWT_PRIVATE_KEY_PATH` /
`JWT_PUBLIC_KEY_PATH` (or inline `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`) and a
distinct `JWT_SIGNING_KID`. Rotation: mint under a new `kid` while still
publishing the old public key in the JWKS until all tokens signed with it expire.

## Security properties (DESIGN §7, §10)

- **RS256 (asymmetric):** only the IdP holds the private key; everyone verifies
  with the published public key. No shared secret to leak.
- **No account enumeration:** unknown user, wrong password, and disabled account
  all return the same generic 401, and a real hash verify runs even when the user
  is absent (constant-time + dummy-hash, so latency does not leak existence).
- **scrypt** password hashing with per-password salt and `timingSafeEqual`.
- **Refresh-token rotation:** refresh tokens are single-use (consume-on-refresh);
  a replayed/stolen token is rejected after first use.
- **`no-store`** on token responses (OAuth 2.0); JWKS is cacheable.
- **helmet** security headers; strict request validation (whitelist + reject
  unknown fields).

## Scripts

| Script                | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| `build` / `typecheck` | `tsc -b` the app                               |
| `start` / `start:dev` | run compiled / ts-node-dev                     |
| `test` / `test:e2e`   | unit (jest) / e2e (boots the real `AppModule`) |
