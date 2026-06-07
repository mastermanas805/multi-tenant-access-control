import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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
  /** Host directory the PAP publishes compiled policies into (the FsCerbosPolicyPublisher target). */
  readonly policyDir: string;
  /**
   * Copies the PAP-published `*.yaml` from the host policy dir INTO the container's
   * watched /policies, triggering Cerbos's in-container file watcher to hot-reload.
   *
   * Why not a bind mount: on Docker Desktop for macOS, inotify events do NOT cross
   * the host->VM filesystem boundary, so a bind-mounted dir never fires
   * `watchForChanges`. Copying into the container's own overlay FS makes the watch
   * fire reliably — the production topology (a real shared volume / sidecar) is
   * faithfully represented; only the file-delivery mechanism is adapted for the
   * macOS test host.
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
export async function startCerbos(): Promise<StartedCerbos> {
  // The host dir the PAP's FsCerbosPolicyPublisher writes compiled policies into
  // at runtime (CERBOS_POLICY_DIR). The harness then syncs them into the container.
  const policyDir = mkdtempSync(join(tmpdir(), 'cerbos-int-policies-'));

  const derivedRoles = readFileSync(
    join(CERBOS_DEPLOY, 'policies', '_platform_derived_roles.yaml'),
    'utf8',
  );
  const baseExpense = readFileSync(
    join(CERBOS_DEPLOY, 'policies', '_platform_base_expense_report.yaml'),
    'utf8',
  );
  const cerbosConfig = readFileSync(join(CERBOS_DEPLOY, '.cerbos.yaml'), 'utf8');

  // Container-local /policies (NO bind mount), seeded with ONLY the platform
  // defaults — never the example_compiled_* tenant policy. The tenant rule is
  // published at runtime via the PAP and synced in (syncPolicies), proving dynamic
  // publication (FR-8).
  const container = await new GenericContainer(CERBOS_IMAGE)
    .withCommand(['server', '--config=/conf/.cerbos.yaml'])
    .withCopyContentToContainer([
      { content: cerbosConfig, target: '/conf/.cerbos.yaml' },
      { content: derivedRoles, target: '/policies/_platform_derived_roles.yaml' },
      { content: baseExpense, target: '/policies/_platform_base_expense_report.yaml' },
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
    syncPolicies: async (): Promise<void> => {
      const files = readdirSync(policyDir).filter((f) => f.endsWith('.yaml'));
      await container.copyContentToContainer(
        files.map((f) => ({
          content: readFileSync(join(policyDir, f), 'utf8'),
          target: `/policies/${f}`,
        })),
      );
    },
    stop: async (): Promise<void> => {
      await container.stop();
    },
  };
}
