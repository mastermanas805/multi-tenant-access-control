import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { CERBOS_HTTP_URL, GATEWAY_URL, TENANT_ACME, WEB_URL } from './constants';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** The monorepo root (two levels up from e2e/src). */
export const REPO_ROOT = resolve(__dirname, '..', '..');

/** When set, globalSetup assumes a stack is ALREADY up and only health-checks it. */
const SKIP_STACK = process.env.E2E_SKIP_STACK === '1';

/**
 * Host port to publish the compose Postgres on. The bootstrap drives the
 * migrations/seeds from the host against this port; the in-mesh services always
 * talk to 5432 internally, so remapping the HOST port is transparent to them.
 * Defaults to 5544 (away from a developer's local 5432) and can be overridden.
 */
const PG_HOST_PORT = process.env.E2E_PG_HOST_PORT ?? '5544';

/**
 * A throwaway compose override so we don't collide with a developer's local
 * Postgres on :5432 (the documented troubleshooting case in RUNNING.md). Written
 * before `up`, removed on teardown — the repo tree stays clean.
 */
const OVERRIDE_PATH = join(REPO_ROOT, 'docker-compose.e2e-override.yml');

function writeOverride(): void {
  // `!override` REPLACES the base service's `ports` list (compose merges list
  // fields by default, which would keep the colliding base `5432:5432` mapping).
  //
  // We also raise the gateway edge rate limit for the test stack: the suite drives
  // the whole demo through the edge (logins, approves, list, audit) and the FR-8
  // test alone re-logs-in several times; under Playwright `retries` the volume can
  // exceed the production default (120/min). Relaxing it ONLY here keeps the
  // committed production default intact while making the suite reliable.
  const yaml = [
    'services:',
    '  postgres:',
    '    ports: !override',
    `      - '${PG_HOST_PORT}:5432'`,
    '  gateway:',
    '    environment:',
    "      RATE_LIMIT_MAX: '100000'",
    "      RATE_LIMIT_WINDOW_MS: '60000'",
    '',
  ].join('\n');
  writeFileSync(OVERRIDE_PATH, yaml, 'utf8');
}

function removeOverride(): void {
  if (existsSync(OVERRIDE_PATH)) {
    rmSync(OVERRIDE_PATH);
  }
}

/** compose args that always include our override file. */
function composeArgs(...rest: string[]): string[] {
  return ['compose', '-f', 'docker-compose.yml', '-f', OVERRIDE_PATH, ...rest];
}

/**
 * Reset the Cerbos policies bind-mount to its committed state. The PAP writes a
 * tenant-scoped `expense_report.<scope>.yaml` there at publish time (FR-8); that
 * file persists on the HOST across `docker compose down -v` (it's a bind mount,
 * not the dropped named volume). On the NEXT cold start it collides with the
 * committed `example_compiled_*` reference policy of the same id, so Cerbos fails
 * the index build ("duplicate definitions") and never goes healthy. Removing the
 * untracked, PAP-generated YAMLs (git clean) makes every run start cold-clean —
 * exactly like a fresh checkout, where the bootstrap republishes the rule.
 */
function resetCerbosPolicies(): void {
  try {
    execFileSync('git', ['clean', '-fdx', 'deploy/cerbos/policies/'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      timeout: 30_000,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stack] could not reset cerbos policies dir (continuing):', err);
  }
}

function sh(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; extraEnv?: Record<string, string> } = {},
): void {
  execFileSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    timeout: opts.timeoutMs ?? 10 * 60 * 1000,
    env: { ...process.env, ...opts.extraEnv },
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll a URL until it returns any HTTP response (2xx-5xx) or the deadline. */
async function waitForHttp(url: string, name: string, tries = 90): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { method: 'GET' });
      // A reachable service is "up" even on 4xx (e.g. audit needs query params).
      if (res.status > 0) {
        // eslint-disable-next-line no-console
        console.log(`[stack] ${name} is up (${String(res.status)})`);
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(2000);
  }
  throw new Error(`[stack] ${name} did not become ready: ${url}`);
}

/**
 * Poll Cerbos until the runtime-published `expense_report` policy is EFFECTIVE
 * (the same warm-up the bootstrap does). This proves the dynamic policy is live
 * before the UI tests run, so the ALLOW case is not racing policy hot-reload.
 */
async function waitForPolicyEffective(tries = 60): Promise<void> {
  const body = {
    requestId: 'e2e-warmup',
    principal: {
      id: 'warmup',
      roles: ['finance_manager'],
      attr: { tenantId: TENANT_ACME, department: 'finance' },
    },
    resources: [
      {
        resource: {
          kind: 'expense_report',
          id: 'warmup',
          scope: 'acme.finance',
          attr: {
            tenantId: TENANT_ACME,
            department: 'finance',
            amount: 1,
            ownerId: 'warmup',
          },
        },
        actions: ['approve'],
      },
    ],
  };
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`${CERBOS_HTTP_URL}/api/check/resources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.includes('"approve":"EFFECT_ALLOW"')) {
          // eslint-disable-next-line no-console
          console.log('[stack] published policy is EFFECTIVE in Cerbos');
          return;
        }
      }
    } catch {
      // not ready yet
    }
    await sleep(1000);
  }
  throw new Error('[stack] published expense_report policy never became effective in Cerbos');
}

/**
 * Restore the seed grants (idempotent). The FR-8 test revokes + re-grants Riya's
 * finance_manager through the UI; if a prior aborted run left it revoked, the
 * bootstrap's seed:dev re-inserts the canonical active grant so the suite starts
 * from a known-good state. Re-running bootstrap is safe per RUNNING.md.
 */
export async function bringStackUp(): Promise<void> {
  if (SKIP_STACK) {
    // eslint-disable-next-line no-console
    console.log('[stack] E2E_SKIP_STACK=1 — not starting compose, only health-checking');
  } else {
    writeOverride();
    // Start cold-clean: drop any PAP-generated policy YAMLs from a prior run so
    // Cerbos's cold index build doesn't fail on duplicate definitions.
    resetCerbosPolicies();
    // eslint-disable-next-line no-console
    console.log(
      `[stack] docker compose up -d --build (Postgres host port ${PG_HOST_PORT}; builds images on first run)…`,
    );
    sh('docker', composeArgs('up', '-d', '--build'), { timeoutMs: 12 * 60 * 1000 });

    // eslint-disable-next-line no-console
    console.log('[stack] running scripts/bootstrap.sh (migrate + seed + publish policy)…');
    // The bootstrap talks to Postgres from the HOST, so point it at the remapped port.
    sh('bash', ['scripts/bootstrap.sh'], {
      timeoutMs: 8 * 60 * 1000,
      extraEnv: { PG_PORT: PG_HOST_PORT },
    });
  }

  // Health gates — every service the UI flows traverse, then the SPA itself.
  await waitForHttp(`${GATEWAY_URL}/health`, 'gateway');
  await waitForHttp('http://localhost:3200/health', 'identity');
  await waitForHttp('http://localhost:3000/health', 'authz-admin');
  await waitForHttp('http://localhost:3300/health', 'expense');
  await waitForHttp('http://localhost:3100/health', 'audit');
  await waitForHttp(`${CERBOS_HTTP_URL}/_cerbos/health`, 'cerbos');
  await waitForPolicyEffective();
  await waitForHttp(WEB_URL, 'web (Demo SPA)');
}

export function bringStackDown(): void {
  if (SKIP_STACK) {
    // eslint-disable-next-line no-console
    console.log('[stack] E2E_SKIP_STACK=1 — leaving the stack running');
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[stack] docker compose down -v (teardown)…');
  try {
    sh('docker', composeArgs('down', '-v'), { timeoutMs: 3 * 60 * 1000 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stack] teardown failed (non-fatal):', err);
  } finally {
    removeOverride();
    // Leave the repo tree clean: drop the PAP-generated policy YAMLs this run wrote.
    resetCerbosPolicies();
  }
}
