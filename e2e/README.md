# End-to-end (Playwright) suite

Drives **every customer flow** through the real Demo UI (`apps/web`, served by nginx
on `:8081`) → gateway (`:8080`) → the five services → Cerbos PDP + Postgres. No
mocks: the only request interception is one negative-auth test that forces a
bad-credential login to assert the server's 401.

## What it does

`globalSetup` (`src/global-setup.ts`) brings the **whole stack** up and bootstraps it:

1. writes a throwaway `docker-compose.e2e-override.yml` that remaps the compose
   Postgres **host** port to `5544` (so it never collides with a developer's local
   `:5432` — the documented RUNNING.md troubleshooting case; the in-mesh services
   always talk to `5432` internally, so this is transparent to them);
2. `docker compose up -d --build`;
3. `scripts/bootstrap.sh` (migrate + seed + **publish the demo policy through the
   PAP** so Cerbos hot-reloads a runtime-defined rule), with `PG_PORT=5544`;
4. waits for every service `/health` **and** for the published `expense_report`
   policy to be **effective** in Cerbos, then for the SPA to serve.

`globalTeardown` runs `docker compose down -v` and removes the override file.

## Run it

```bash
# from the repo root
pnpm test:playwright

# or from this package
pnpm --filter @tests/e2e-playwright run test:playwright
```

First run also needs the browser (done once):

```bash
pnpm --filter @tests/e2e-playwright exec playwright install --with-deps chromium
```

Useful env toggles:

| Env | Default | Effect |
|---|---|---|
| `E2E_SKIP_STACK=1` | _unset_ | Don't start/stop compose; only health-check an already-running stack (fast iteration). |
| `E2E_PG_HOST_PORT` | `5544` | Host port to publish compose Postgres on. |
| `WEB_URL` | `http://localhost:8081` | Where the SPA is served. |
| `GATEWAY_URL` | `http://localhost:8080` | Edge used for health waits. |

## Design

- **Page objects** (`src/pages/*.page.ts`): `LoginPage`, `ExpensesPage`,
  `AdminPage`, `DecisionLogPage`. They wait on **data-testids** and **captured
  network Responses** — no sleeps.
- **`loginAs(user)` fixture** (`src/fixtures/app.fixture.ts`): navigates, logs in
  through the gateway, returns the ready page objects.
- Every assertion checks **both** the visible UI result **and** that it came from
  the server (the captured HTTP status + the response body's `decisionId` /
  `reason`), so a UI that merely *looked* right cannot pass.
- Single worker: the FR-8 test mutates shared backend state (Riya's
  `finance_manager` grant), so the suite is serialized and restores the grant.

## Flows covered (6 files → 12 runtime tests)

The auth login is parametrized over the three seeded users, so `01-auth.spec.ts`
expands to 4 tests; the rest are one test each (12 total).

| File | Flow |
|---|---|
| `tests/01-auth.spec.ts` | Login as Riya / Sam / Dev → 200 + role shown; invalid credentials → server 401 + `login-error`; seeded-user list renders. |
| `tests/02-decisions.spec.ts` | Riya approve `exp_42` ($8.5k same-dept) → ALLOW (200) + decisionId; `exp_99` ($25k) → DENY (403) ABAC `amount<10000`; Globex `exp_glx` → DENIED (cross-tenant, RLS-invisible 404). |
| `tests/03-rbac.spec.ts` | Sam (engineer) approve → DENIED (403, no rule grants it). |
| `tests/04-dynamic-fr8.spec.ts` | Dev revokes Riya's `finance_manager` → Riya approve flips to DENIED (live); Dev re-grants → Riya approve flips back to ALLOWED. |
| `tests/05-audit.spec.ts` | Decision-log panel shows a real ALLOW and a real DENY entry with reason + decisionId (matching the approve responses). |
| `tests/06-security-ux.spec.ts` | Sam's Approve button is visible + enabled; clicking it returns a server 403 — proving UI-hiding is not the gate. |
