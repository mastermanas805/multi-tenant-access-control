# Cerbos PDP — deploy assets

The Policy Decision Point (DESIGN §3.2). Cerbos is **stateless**: it loads policy
YAML from disk and answers `check` calls; it owns no database (DESIGN §8.3). The
**PAP compiles each tenant's runtime-defined rules into the YAML in `policies/`
and the PDP hot-reloads them** within seconds — no redeploy (DESIGN §3.4, §8.7).

## Layout

| Path | What | Authored by |
|---|---|---|
| `.cerbos.yaml` | PDP config: gRPC `:3593`, disk storage, `watchForChanges` | platform (this repo) |
| `policies/_platform_derived_roles.yaml` | reusable derived roles (owner, same_department, same_tenant) | **platform default** |
| `policies/_platform_base_expense_report.yaml` | base scope-less tenant-isolation guardrail (DESIGN §3.1) | **platform default** |
| `policies/example_compiled_acme_finance_expense_report.yaml` | a **compiled tenant policy** (DESIGN §3.1) | **demo/seed** — normally the PAP writes this at runtime |

> Files prefixed `_platform_` are platform defaults. The `example_compiled_*` file
> is demo data illustrating exactly what the PAP-publish step emits; in production
> the PAP writes tenant policies into this directory at runtime. **No tenant rule
> is hardcoded** (DESIGN §3.1).

## Run (Docker — `cerbos/cerbos`)

Standalone:

```bash
docker run --rm \
  -p 3593:3593 -p 3592:3592 \
  -v "$(pwd)/deploy/cerbos/.cerbos.yaml:/conf/.cerbos.yaml:ro" \
  -v "$(pwd)/deploy/cerbos/policies:/policies" \
  cerbos/cerbos:0.41.0 server --config=/conf/.cerbos.yaml
```

- gRPC `:3593` — what `CerbosPdpClient` (`@cerbos/grpc`) connects to (`CERBOS_URL`).
- HTTP `:3592` — health/REST; smoke test: `curl localhost:3592/_cerbos/health`.

Via docker-compose (the `cerbos` service is wired in the root `docker-compose.yml`);
the policies dir is bind-mounted **read-write** so the PAP can publish into it.

## How a published policy reaches the PDP

1. A tenant admin publishes a rule via the PAP (`POST /admin/v1/policies`) — stored
   as DB jsonb (`PolicyRuleBody`), versioned, source of truth (DESIGN §8.7).
2. On activate, the PAP compiles it with `compilePolicyToCerbos` (`@authz/pep`)
   into a `resourcePolicy` YAML and writes it into `policies/`.
3. `watchForChanges` makes the PDP hot-reload it in seconds (DESIGN §3.4, FR-8).
4. The next `CerbosPdpClient.check` evaluates against the new policy.
