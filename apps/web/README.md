# Demo UI (`@app/web`)

A minimal Vite + React + TypeScript SPA — the **Client** in DESIGN §4, spec'd in
§13. It is a **thin** front-end to the **API Gateway** that **never makes authz
decisions; it only reflects them**. It talks to **nothing but the gateway**
(`VITE_GATEWAY_URL`).

## Screens

1. **Login / user switch** — pick a seeded user (Riya = `finance_manager`,
   Sam = `engineer`, Dev = `org_admin`); calls `POST /v1/auth/token` and keeps the
   JWT **in memory** (never `localStorage` — an XSS cannot exfiltrate a persisted
   token; see `src/api.ts`).
2. **Expenses** — `GET /v1/expenses` (PDP-filtered), with an **Approve** button on
   every row. ALLOW → 200 + the ALLOW reason; DENY → 403 + the PDP reason from the
   §8.1 envelope. The Approve button is rendered **even for users who will be
   denied** — hiding it is UX, not security; the PEP is the real gate.
3. **Admin** (Dev only) — list Riya's role assignments, **REVOKE / GRANT**
   `finance_manager` (PAP via the gateway). Banner: *takes effect in seconds*
   (FR-8). Switch to Riya and retry to see a decision flip.
4. **Decision-log panel** — the latest decisions (allow/deny + reason +
   `decisionId`) read from the **audit** service through the gateway.

## Run

```bash
# Local dev (gateway must be up: docker compose up -d && ./scripts/bootstrap.sh)
pnpm --filter @app/web run dev          # http://localhost:5173

# Or via compose (nginx-served build on http://localhost:8081)
docker compose up -d --build web
```

`VITE_GATEWAY_URL` defaults to `http://localhost:8080`. Set it to point the SPA at
a different gateway origin (build-time for the bundle).

## Scripts

```bash
pnpm --filter @app/web run typecheck
pnpm --filter @app/web run build
pnpm --filter @app/web run lint
```
