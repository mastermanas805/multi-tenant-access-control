#!/usr/bin/env bash
#
# One-command bootstrap for the full enforcement stack (DESIGN §11 demo).
#
#   docker compose up -d --build      # bring the whole stack up first
#   ./scripts/bootstrap.sh            # then run this
#
# It is idempotent (safe to re-run) and does five things:
#   1. waits for Postgres + Cerbos + the services to be healthy;
#   2. runs the TypeORM migrations for all three databases (authz_admin, audit,
#      expense) as the bootstrap SUPERUSER — this also provisions the unprivileged
#      authz_app / expense_app roles + RLS the long-running APIs connect as;
#   3. seeds the demo data (tenants/roles/assignments + demo expenses);
#   4. PUBLISHES the demo `expense_report` policy through the PAP so Cerbos
#      hot-reloads a REAL, runtime-defined rule (finance_manager may approve when
#      amount < 10000 AND resource.department == principal.department, plus the
#      tenant guardrail) — proving policies are published dynamically, NOT baked in;
#   5. waits until that policy is EFFECTIVE in Cerbos, then prints the demo curls.
#
# Migrations/seeds are driven FROM THE HOST against the compose-exposed localhost
# ports (the host pnpm workspace has the ts-node toolchain the migration CLI uses;
# the slim runtime images are production-only). Override the superuser creds with
# PG_SUPER_USER / PG_SUPER_PASS if you changed them in docker-compose.yml.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_SUPER_USER="${PG_SUPER_USER:-authz}"
PG_SUPER_PASS="${PG_SUPER_PASS:-authz}"

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
PAP_URL="${PAP_URL:-http://localhost:3000}"
CERBOS_HTTP_URL="${CERBOS_HTTP_URL:-http://localhost:3592}"

TENANT_ACME="aaaaaaaa-0000-4000-8000-000000000001"

log() { printf '\033[1;36m[bootstrap]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[bootstrap] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

wait_for_http() {
  local url="$1" name="$2" tries="${3:-60}"
  log "waiting for $name ($url) ..."
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then log "$name is up"; return 0; fi
    sleep 2
  done
  die "$name did not become ready: $url"
}

# 1) Readiness ---------------------------------------------------------------
wait_for_http "$CERBOS_HTTP_URL/_cerbos/health" "cerbos"
wait_for_http "http://localhost:3000/health" "authz-admin"
wait_for_http "http://localhost:3100/health" "audit"
wait_for_http "http://localhost:3200/health" "identity"
wait_for_http "http://localhost:3300/health" "expense"
wait_for_http "$GATEWAY_URL/health" "gateway"

# 2) Migrations (as the bootstrap superuser) ---------------------------------
run_migration() {
  local filter="$1" db="$2" appuser="${3:-}" apppass="${4:-}"
  log "migrating $db ($filter) ..."
  DB_HOST="$PG_HOST" DB_PORT="$PG_PORT" \
  DB_USERNAME="$PG_SUPER_USER" DB_PASSWORD="$PG_SUPER_PASS" \
  DB_DATABASE="$db" DB_ENABLED=true DB_SYNCHRONIZE=false \
  DB_APP_USERNAME="$appuser" DB_APP_PASSWORD="$apppass" \
    pnpm --filter "$filter" run migration:run
}
run_migration @app/authz-admin authz_admin authz_app authz_app
run_migration @app/audit audit
run_migration @app/expense expense expense_app expense_app

# 3) Seeds (as the bootstrap superuser) --------------------------------------
run_seed() {
  local filter="$1" db="$2"
  log "seeding $db ($filter) ..."
  DB_HOST="$PG_HOST" DB_PORT="$PG_PORT" \
  DB_USERNAME="$PG_SUPER_USER" DB_PASSWORD="$PG_SUPER_PASS" \
  DB_DATABASE="$db" DB_ENABLED=true DB_SYNCHRONIZE=false \
    pnpm --filter "$filter" run seed:dev
}
run_seed @app/authz-admin authz_admin
run_seed @app/expense expense

# 4) Publish the demo policy through the PAP (dynamic — NOT pre-baked) --------
log "publishing the demo expense_report policy through the PAP ..."
PUBLISH_BODY=$(cat <<JSON
{
  "scope": "acme.finance",
  "effectiveDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "rule": {
    "resource": "expense_report",
    "rules": [
      {
        "name": "finance_manager_approve",
        "actions": ["read", "approve"],
        "effect": "ALLOW",
        "roles": ["finance_manager"],
        "condition": {
          "all": [
            { "expr": "request.resource.attr.amount < 10000" },
            { "expr": "request.resource.attr.department == request.principal.attr.department" }
          ]
        }
      }
    ]
  }
}
JSON
)
HTTP_CODE=$(curl -sS -o /tmp/bootstrap-publish.json -w '%{http_code}' \
  -X POST "$PAP_URL/v1/policies" \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT_ACME" \
  -H 'x-actor-id: dev' \
  -d "$PUBLISH_BODY") || die "policy publish request failed"
case "$HTTP_CODE" in
  201|200) log "policy published (HTTP $HTTP_CODE)";;
  409) log "policy already published (HTTP 409) — continuing (idempotent)";;
  *) cat /tmp/bootstrap-publish.json; die "policy publish returned HTTP $HTTP_CODE";;
esac

# 5) Wait until the published policy is effective in Cerbos -------------------
log "waiting for Cerbos to hot-reload the published policy ..."
WARMUP=$(cat <<JSON
{"requestId":"bootstrap-warmup",
 "principal":{"id":"warmup","roles":["finance_manager"],"attr":{"tenantId":"$TENANT_ACME","department":"finance"}},
 "resources":[{"resource":{"kind":"expense_report","id":"warmup","scope":"acme.finance",
   "attr":{"tenantId":"$TENANT_ACME","department":"finance","amount":1,"ownerId":"warmup"}},
   "actions":["approve"]}]}
JSON
)
for _ in $(seq 1 60); do
  EFFECT=$(curl -fsS -X POST "$CERBOS_HTTP_URL/api/check/resources" \
    -H 'content-type: application/json' -d "$WARMUP" 2>/dev/null \
    | grep -o '"approve":"EFFECT_ALLOW"' || true)
  if [ -n "$EFFECT" ]; then log "policy is EFFECTIVE in Cerbos"; break; fi
  sleep 1
done

cat <<DONE

\033[1;32m[bootstrap] DONE — the stack is seeded and the demo policy is live.\033[0m

Try the demo (DESIGN §11) — log in at the Identity IdP, then call the gateway:

  # 1) Log in as Riya (finance manager) -> RS256 JWT (Identity password grant)
  TOKEN=\$(curl -sS -X POST http://localhost:3200/v1/auth/token \\
            -H 'content-type: application/json' \\
            -d '{"email":"riya@acme.com","password":"Password123!"}' | jq -r .accessToken)

  # 2) ALLOW: approve an \$8,500 same-department expense through the gateway -> 200
  curl -sS -X POST $GATEWAY_URL/v1/expenses/exp_42/approve \\
       -H "authorization: Bearer \$TOKEN" -d '{}'

  # 3) DENY (ABAC amount<10000): approve the \$25,000 expense -> 403 + reason
  curl -sS -X POST $GATEWAY_URL/v1/expenses/exp_99/approve \\
       -H "authorization: Bearer \$TOKEN" -d '{}'

See RUNNING.md for the full walk-through (tenant-isolation + dynamic-revocation cases).
DONE
