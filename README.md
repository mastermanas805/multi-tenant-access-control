# Access Control Across Microservices in a Multi-Tenant Architecture

[![CI](https://github.com/mastermanas805/multi-tenant-access-control/actions/workflows/ci.yml/badge.svg)](https://github.com/mastermanas805/multi-tenant-access-control/actions/workflows/ci.yml)

Enterprise-grade **authorization system** design for a multi-tenant, microservices-based SaaS platform — thousands of tenants, millions of users, high request throughput.

> **CI** runs four tiers on every push — typecheck/lint/build, unit, service e2e, **integration (real Postgres + Cerbos via Testcontainers)**, and **Playwright** (full `docker-compose` stack).

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
- ✅ **Demo UI** — Vite + React SPA (a thin client to the gateway); `docker compose up` → **http://localhost:8081**
- ✅ **Test suite — GREEN across all four tiers** (typecheck · build · lint all pass): **45 suites / 221 unit · 11 suites / 74 service e2e · 3 suites / 19 Testcontainers integration · 6 files / 12 Playwright UI** — see [TESTING.md](./TESTING.md) and the [customer-flow → test matrix](./TESTING.md#customer-flow--test-mapping)

## Reference implementation

A focused slice demonstrating the model end-to-end (depth over breadth):
**API Gateway** (authN edge) · **Identity** (OIDC-style IdP) · **Authorization Admin**
(PAP — publishes policies to Cerbos, serves the PIP) · **Expense** service (PEP →
co-located Cerbos PDP) · **Audit** (tamper-evident hash chain) · **Demo UI**
(thin SPA → gateway) · **PostgreSQL** per service with **Row-Level Security** ·
`docker-compose` + a one-command bootstrap.

The canonical access-control cases ship as **executable tests** at four tiers —
unit, per-service HTTP e2e, **Testcontainers integration** (real Postgres + real
Cerbos, no mocks), and a full-stack **Playwright UI** suite that drives every
customer flow through the real SPA → gateway → services. See
[RUNNING.md](./RUNNING.md) to bring the stack up and run the demo,
[CUSTOMER_FLOWS.md](./CUSTOMER_FLOWS.md) for every flow, and [TESTING.md](./TESTING.md)
for the full test strategy and how to run each tier.

## Tech stack

Node.js · TypeScript · NestJS · Cerbos · PostgreSQL · Docker Compose · React (Vite) for the demo UI.
