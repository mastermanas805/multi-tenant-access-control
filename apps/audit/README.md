# Audit Service — NestJS

The **append-only, tamper-evident decision/admin log** for the multi-tenant
access-control platform (DESIGN §10, Appendix C). PEPs post a `DecisionAuditRecord`
after every enforced check (and the PAP posts admin/PAP changes); this service
appends each event to a per-record **hash chain** so any later modification,
deletion, or reorder is detectable — even by an insider with direct DB access.

It is the compliance **system of record**: persisted to its **own `audit`
database**, intentionally **not** in the OLTP path of the other services
(DESIGN §8.7 — "Never in the OLTP DB"). In production the pipeline is
PEPs → Kafka → S3-Parquet/WORM + ClickHouse; this reference slice implements the
in-band integrity primitive (the hash chain) over Postgres.

Hexagonal architecture (domain → application → infrastructure → presentation),
mirroring the `authz-admin` conventions.

| Route (`/v1`)                  | Purpose                                                    |
| ------------------------------ | --------------------------------------------------------- |
| `POST /audit/events`           | Append a decision/admin event to the chain (idempotent)   |
| `GET /audit/events`            | List events (cursor pagination), filterable by `tenantId` |
| `GET /audit/events/verify`     | Replay the chain and report whether it is intact          |
| `GET /health`                  | Liveness + DB readiness (Terminus)                        |
| `GET /docs`                    | OpenAPI / Swagger UI                                       |

## The hash chain (tamper evidence)

Each row stores `record_hash = sha256( prev_hash || canonical(event) )` where
`prev_hash` is the previous row's `record_hash` (the first row links to the
**genesis hash** = 64 hex zeros) and `canonical(event)` is a deterministic,
fixed-key-order serialization of the event's signed fields (see
`domain/hash-chain.ts`). `seq` is a gap-free `BIGSERIAL` that totally orders the
chain.

Two layers protect the log:

1. **Append-only at the database** — a trigger rejects `UPDATE`/`DELETE` on
   `audit_events`, so the log is immutable in fact, not just by convention.
2. **Hash chain** — even if the trigger is bypassed (an insider with DDL),
   editing any field breaks that row's `record_hash`, and deleting/reordering any
   row breaks the `prev_hash` link of every later row. `GET /audit/events/verify`
   replays from genesis and pinpoints the first broken `seq`.

(Verified end-to-end against a live Postgres: trigger blocks UPDATE/DELETE; a
trigger-bypassed edit is caught by verify with `valid:false` at the tampered seq.)

## Append concurrency

Appends run in a `SERIALIZABLE` transaction that re-reads the chain head inside
the tx and re-links the record to it, so two concurrent appends can never both
link to the same head. The loser retries against the new head; the unique index
on `record_hash` is a final backstop.

## Quick start (full stack)

From the **repository root** (the `audit` service + its own `audit` database are in
`docker-compose.yml`; the DB is created by `deploy/postgres/init`, and the migration
is run by the one-command bootstrap):

```bash
docker compose up -d --build      # postgres, cerbos, identity, authz-admin, audit, expense, gateway
./scripts/bootstrap.sh            # migrate all DBs (incl. audit_events + trigger) + seed + publish policy
open http://localhost:3100/docs
```

See **[RUNNING.md](../../RUNNING.md)** for the end-to-end demo and troubleshooting.
Health probe: `curl http://localhost:3100/health`.

```bash
# Append a decision event:
curl -s -X POST http://localhost:3100/v1/audit/events -H 'content-type: application/json' -d '{
  "tenantId":"aaaaaaaa-0000-4000-8000-000000000001",
  "actor":"riya","action":"approve","decision":"ALLOW",
  "resourceKind":"expense_report","resourceId":"exp_1",
  "reason":"finance_manager same dept","policy":"expense_report/acme.finance",
  "decisionId":"dec_1","traceId":"trc_1","at":"2026-06-06T09:59:00.000Z"
}' | jq

# List a tenant's events, then verify the whole chain:
curl -s 'http://localhost:3100/v1/audit/events?tenantId=aaaaaaaa-0000-4000-8000-000000000001' | jq
curl -s http://localhost:3100/v1/audit/events/verify | jq
```

## Running on the host (without Docker for the app)

```bash
pnpm install                                  # from the repo root
DB_DATABASE=audit pnpm --filter @app/audit run migration:run
pnpm --filter @app/audit run start:dev        # http://localhost:3100/docs
```

## Scripts

| Script                | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| `build` / `typecheck` | `tsc -b` the app                               |
| `start` / `start:dev` | run compiled / ts-node-dev                     |
| `test` / `test:e2e`   | unit (jest) / e2e (boots the real `AppModule`) |
| `migration:run`       | apply the migration (table + indexes + append-only trigger) |
| `migration:revert`    | revert the last migration                      |
| `migration:show`      | list applied/pending migrations                |

## Notes

- **AuthN/Z** is out of scope for this slice: in production the ingest endpoint
  sits behind mTLS/SPIFFE (only trusted PEPs append, DESIGN §7/§10) and the read
  endpoint behind the admin JWT scope for the decision-explainer. The hash chain
  is the in-band integrity guarantee regardless.
- **No RLS** here: the audit DB is a separate trust boundary written only by this
  service. `tenant_id` is a plain, indexed column for filtering/export (App. C).
- **GDPR vs immutability** (App. C): production stores PII by reference
  (tokenized) and crypto-shreds the key on erasure, leaving the chain intact.
  This slice records IDs-not-payloads, consistent with that model.
```
