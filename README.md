# Access Control Across Microservices in a Multi-Tenant Architecture

Enterprise-grade **authorization system** design for a multi-tenant, microservices-based SaaS platform — thousands of tenants, millions of users, high request throughput.

> 📄 **Full design document: [DESIGN.md](./DESIGN.md)**
> 🚀 **Run it locally: [RUNNING.md](./RUNNING.md)** — `docker compose up` → `./scripts/bootstrap.sh` → demo.

## What this is

A design-first take-home: an end-to-end authorization architecture plus a focused, runnable reference implementation. The design covers functional/non-functional requirements, high-level architecture, authN/authZ flow, multi-tenant isolation, the access-control model, service-to-service security, APIs & data/storage models, scalability/reliability, security/compliance, and operations — with assumptions, tradeoffs, and justified decisions throughout.

## Key decisions at a glance

| Area | Choice |
|---|---|
| Authorization model | Hybrid **RBAC + ABAC** with hierarchical scopes |
| Policy engine (PDP) | **Cerbos** (stateless, policy-as-code); OpenFGA as the documented ReBAC alternative |
| Topology | **Co-located PDP** (sidecar) + local enforcement (PEP) — authz on every request's hot path |
| Tokens | Identity + tenant only; permissions resolved **per-request** (no stale-JWT) |
| Tenant isolation | Defense-in-depth: edge claim → PDP guardrail → Postgres **RLS**; pool-by-default, silo tier |
| Service-to-service | **mTLS/SPIFFE** + signed internal token + re-authorize every hop |
| Data layer | **PostgreSQL** per service (ACID, RLS, `ltree` hierarchy, CDC); audit via Kafka → S3/WORM + ClickHouse |

Rationale for each lives in the design doc's **Tradeoffs & Decisions** table.

## Status

- ✅ **Design document** — complete ([DESIGN.md](./DESIGN.md))
- ✅ **Reference implementation** — runnable end-to-end (Node.js / TypeScript, NestJS, Cerbos, PostgreSQL + RLS)

## Reference implementation

A focused slice demonstrating the model end-to-end (depth over breadth):
**API Gateway** (authN edge) · **Identity** (OIDC-style IdP) · **Authorization Admin**
(PAP — publishes policies to Cerbos, serves the PIP) · **Expense** service (PEP →
co-located Cerbos PDP) · **Audit** (tamper-evident hash chain) · **PostgreSQL** per
service with **Row-Level Security** · `docker-compose` + a one-command bootstrap.

The canonical access-control cases ship as **executable integration tests** that run
against **real Postgres + real Cerbos** (Testcontainers) — see
[RUNNING.md](./RUNNING.md) to bring the stack up and run the demo, and
`pnpm -w run test:integration` for the end-to-end suite.

## Tech stack

Node.js · TypeScript · NestJS · Cerbos · PostgreSQL · Docker Compose · React (Vite) for the demo UI.
