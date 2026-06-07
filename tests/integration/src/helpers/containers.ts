import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

/** The Cerbos image pinned to the same version the compose stack runs. */
const CERBOS_IMAGE = 'cerbos/cerbos:0.41.0';
/** Postgres pinned to the same major the compose stack runs. */
const POSTGRES_IMAGE = 'postgres:16';

/** Absolute path to the repo's deploy/ assets (two levels up from this file's pkg). */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const CERBOS_DEPLOY = join(REPO_ROOT, 'deploy', 'cerbos');

/** Bootstrap superuser used for migrations + seeds (NOT the runtime app role). */
export const PG_SUPERUSER = 'authz';
export const PG_SUPERPASS = 'authz';
/** The first DB the Postgres image creates; the others are created by the harness. */
export const PG_BOOTSTRAP_DB = 'authz_admin';

export interface StartedPostgres {
  readonly container: StartedTestContainer;
  readonly host: string;
  readonly port: number;
  stop(): Promise<void>;
}

export interface StartedCerbos {
  readonly container: StartedTestContainer;
  readonly host: string;
  readonly grpcPort: number;
  /** Mapped HTTP port (health + the REST check API used to await hot-reload). */
  readonly httpPort: number;
  /**
   * Host directory the PAP publishes compiled policies into (the
   * FsCerbosPolicyPublisher target). It is BIND-MOUNTED into the container's watched
   * /policies, so a runtime publish lands directly where Cerbos watches.
   */
  readonly policyDir: string;
  /**
   * No-op kept for interface compatibility: because policyDir IS the bind-mounted
   * /policies, the PAP's write is already visible to Cerbos's `watchForChanges`
   * (Linux CI — the source of truth). This mirrors the docker-compose topology.
   */
  syncPolicies(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Starts a real Postgres 16 with the bootstrap superuser. The three service
 * databases (authz_admin, audit, expense) are created by the harness after start
 * (mirrors deploy/postgres/init), so a single instance backs the whole stack —
 * the same topology as docker-compose.
 */
export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: PG_SUPERUSER,
      POSTGRES_PASSWORD: PG_SUPERPASS,
      POSTGRES_DB: PG_BOOTSTRAP_DB,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .start();

  return {
    container,
    host: container.getHost(),
    port: container.getMappedPort(5432),
    stop: async (): Promise<void> => {
      await container.stop();
    },
  };
}

/**
 * Starts a real Cerbos PDP whose /policies dir is bind-mounted to a fresh host
 * temp dir seeded with ONLY the platform defaults (derived roles + base
 * guardrail). The tenant `acme.finance` policy is deliberately ABSENT at start so
 * the test proves it is DYNAMICALLY published through the PAP at runtime (FR-8,
 * DESIGN §3.4) — not pre-baked into the image. `watchForChanges` (in .cerbos.yaml)
 * makes the PDP hot-reload the published file within seconds.
 */
/**
 * Creates + seeds the host policy dir the PAP publishes into (CERBOS_POLICY_DIR),
 * with ONLY the platform defaults (derived roles + base guardrail). The tenant
 * `acme.finance` rule is deliberately ABSENT — it is published DYNAMICALLY through
 * the PAP at runtime (FR-8, DESIGN §3.4), never pre-baked. World-readable so the
 * container's non-root cerbos user can read the files once they're copied in.
 *
 * Returns the dir; call BEFORE booting the PAP (so the PAP can write into it), then
 * pass it to {@link startCerbos} AFTER publishing.
 */
export function prepareCerbosPolicyDir(): string {
  const policyDir = mkdtempSync(join(tmpdir(), 'cerbos-int-policies-'));
  chmodSync(policyDir, 0o755);
  writeFileSync(
    join(policyDir, '_platform_derived_roles.yaml'),
    readFileSync(join(CERBOS_DEPLOY, 'policies', '_platform_derived_roles.yaml'), 'utf8'),
    { mode: 0o644 },
  );
  writeFileSync(
    join(policyDir, '_platform_base_expense_report.yaml'),
    readFileSync(join(CERBOS_DEPLOY, 'policies', '_platform_base_expense_report.yaml'), 'utf8'),
    { mode: 0o644 },
  );
  return policyDir;
}

/**
 * Starts a real Cerbos PDP with EVERY policy in `policyDir` (platform defaults plus
 * any rule the PAP has already published) COPIED IN AND LOADED AT STARTUP, so they
 * are effective the moment Cerbos is healthy — with NO dependency on fsnotify
 * hot-reload, which is unreliable for Testcontainers file delivery on Linux CI and
 * across the macOS host->VM boundary. (The genuine watch-based hot-reload over a
 * real bind-mount is covered end-to-end by the Playwright/compose suite.) Call
 * AFTER the PAP has published the tenant rule into `policyDir`.
 */
export async function startCerbos(policyDir: string): Promise<StartedCerbos> {
  const cerbosConfig = readFileSync(join(CERBOS_DEPLOY, '.cerbos.yaml'), 'utf8');
  const policyFiles = readdirSync(policyDir).filter((f) => f.endsWith('.yaml'));

  const container = await new GenericContainer(CERBOS_IMAGE)
    .withCommand(['server', '--config=/conf/.cerbos.yaml'])
    .withCopyContentToContainer([
      { content: cerbosConfig, target: '/conf/.cerbos.yaml' },
      ...policyFiles.map((f) => ({
        content: readFileSync(join(policyDir, f), 'utf8'),
        target: `/policies/${f}`,
      })),
    ])
    .withExposedPorts(3593, 3592)
    .withWaitStrategy(Wait.forHttp('/_cerbos/health', 3592).forStatusCode(200))
    .start();

  return {
    container,
    host: container.getHost(),
    grpcPort: container.getMappedPort(3593),
    httpPort: container.getMappedPort(3592),
    policyDir,
    // No-op: every policy was loaded at Cerbos startup (see above), so there is
    // nothing to sync. Kept for interface compatibility.
    syncPolicies: async (): Promise<void> => {
      /* policies are loaded at startup; nothing to do */
    },
    stop: async (): Promise<void> => {
      await container.stop();
    },
  };
}
