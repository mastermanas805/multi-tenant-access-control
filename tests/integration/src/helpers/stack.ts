import 'reflect-metadata';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';

// Real app composition roots + their DataSource builders + seeds (imported by
// RELATIVE path — the apps use only @kernel/@contracts/@authz aliases internally,
// never @app/*, so this resolves cleanly under ts-jest).
import { AppModule as AuthzAdminAppModule } from '../../../../apps/authz-admin/src/app.module';
import { GlobalExceptionFilter as AuthzAdminFilter } from '../../../../apps/authz-admin/src/shared/presentation/global-exception.filter';
import { buildDataSourceOptions as authzAdminDsOptions } from '../../../../apps/authz-admin/src/shared/infrastructure/database/data-source';

import { AppModule as AuditAppModule } from '../../../../apps/audit/src/app.module';
import { GlobalExceptionFilter as AuditFilter } from '../../../../apps/audit/src/shared/presentation/global-exception.filter';
import { buildDataSourceOptions as auditDsOptions } from '../../../../apps/audit/src/shared/infrastructure/database/data-source';

import { AppModule as ExpenseAppModule } from '../../../../apps/expense/src/app.module';
import { GlobalExceptionFilter as ExpenseFilter } from '../../../../apps/expense/src/shared/presentation/global-exception.filter';
import { buildDataSourceOptions as expenseDsOptions } from '../../../../apps/expense/src/shared/infrastructure/database/data-source';

import {
  PG_BOOTSTRAP_DB,
  PG_SUPERPASS,
  PG_SUPERUSER,
  type StartedCerbos,
  type StartedPostgres,
  prepareCerbosPolicyDir,
  startCerbos,
  startPostgres,
} from './containers';
import {
  INTERNAL_TOKEN_ISSUER,
  INTERNAL_TOKEN_SECRET,
  internalIdentityHeaders,
} from './identity-token';
import { DEMO_EXPENSE_POLICY_RULE, SCOPE_ACME_FINANCE, TENANT_ACME } from './seed-data';
import { seedAuthzAdmin } from './seed-authz-admin';
import { seedExpense } from './seed-expense';

/** The unprivileged runtime role the OLTP apps connect as (RLS is enforced). */
const AUTHZ_APP_ROLE = 'authz_app';
const EXPENSE_APP_ROLE = 'expense_app';

export interface RunningStack {
  readonly papUrl: string;
  readonly auditUrl: string;
  readonly expenseUrl: string;
  readonly cerbos: StartedCerbos;
  readonly postgres: StartedPostgres;
  /** Superuser DataSource against the authz_admin DB (for RLS-isolation probes). */
  readonly authzAdminSuperDs: DataSource;
  /** Unprivileged DataSource against the authz_admin DB (RLS enforced). */
  readonly authzAdminAppDs: DataSource;
  /** Superuser DataSource against the expense DB (for RLS-isolation probes). */
  readonly expenseSuperDs: DataSource;
  /** Unprivileged DataSource against the expense DB (RLS enforced). */
  readonly expenseAppDs: DataSource;
  stop(): Promise<void>;
}

/** Snapshot/restore process.env around a per-app boot (each ConfigService reads it). */
function withEnv(overrides: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  };
}

/** Boots a Nest app exactly as its main.ts does (versioning + ValidationPipe + §8.1 filter). */
async function bootApp(
  module: unknown,
  filterToken: unknown,
): Promise<{ app: NestExpressApplication; url: string }> {
  const app = await NestFactory.create<NestExpressApplication>(
    module as Parameters<typeof NestFactory.create>[0],
    { logger: ['error', 'warn'] },
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(app.get(filterToken as never));
  app.enableShutdownHooks();
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${String(address.port)}` };
}

/** Creates a database if absent, via the bootstrap (postgres) DB connection. */
async function ensureDatabase(superDs: DataSource, name: string): Promise<void> {
  const rows = await superDs.query<unknown[]>(
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [name],
  );
  if (rows.length === 0) {
    await superDs.query(`CREATE DATABASE "${name}"`);
  }
}

/** Runs an app's migrations as the bootstrap superuser (DDL + role provisioning). */
async function runMigrations(
  options: ReturnType<typeof authzAdminDsOptions>,
): Promise<void> {
  const ds = new DataSource(options);
  await ds.initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
}

/**
 * Polls the Cerbos REST check API with a synthetic finance_manager request until
 * the runtime-published `acme.finance` expense_report policy is EFFECTIVE (returns
 * EFFECT_ALLOW for approve). Cerbos `watchForChanges` reloads the watched dir
 * asynchronously, so this gates the suite on the published rule actually being
 * live — the FR-8 staleness bound, observed.
 */
async function waitForPolicyEffective(cerbosHttpUrl: string): Promise<void> {
  // 60s headroom: syncPolicies restarts the PDP, so this poll also rides through
  // the restart (connection errors are caught + retried) until the published
  // acme.finance rule is live on slower CI runners.
  const deadline = Date.now() + 60_000;
  const body = {
    requestId: 'int-warmup',
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
          scope: SCOPE_ACME_FINANCE,
          attr: { tenantId: TENANT_ACME, department: 'finance', amount: 1, ownerId: 'warmup' },
        },
        actions: ['approve'],
      },
    ],
  };

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${cerbosHttpUrl}/api/check/resources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          results?: { actions?: Record<string, string> }[];
        };
        const effect = json.results?.[0]?.actions?.approve;
        if (effect === 'EFFECT_ALLOW') {
          return;
        }
      }
    } catch {
      // Cerbos not ready yet; retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Timed out waiting for the runtime-published acme.finance policy to take effect');
}

/**
 * Stands up the FULL enforcement stack against real Postgres + real Cerbos
 * (Testcontainers) and a runtime-PUBLISHED policy, then returns live HTTP URLs:
 *
 *   1. start Postgres + Cerbos (Cerbos seeded with ONLY platform defaults);
 *   2. create the audit + expense databases (mirrors deploy/postgres/init);
 *   3. migrate all three DBs as the superuser (provisions the unprivileged
 *      authz_app / expense_app roles + RLS);
 *   4. seed authz_admin (tenants/roles/assignments) + expense (demo expenses);
 *   5. boot the PAP, Audit and Expense Nest apps in-process — Expense wired to the
 *      REAL Cerbos gRPC + the in-process PAP (PIP) + Audit (sink), connecting as
 *      the UNPRIVILEGED role so Postgres RLS actually holds;
 *   6. PUBLISH the demo expense_report policy through the PAP HTTP API so Cerbos
 *      hot-reloads a REAL, runtime-defined rule (nothing pre-baked — FR-8).
 */
export async function startStack(): Promise<RunningStack> {
  const postgres = await startPostgres();
  // Prepare the policy dir (platform defaults only) up front; the PAP publishes the
  // tenant rule into it, then Cerbos is started with everything loaded at boot (5d).
  const policyDir = prepareCerbosPolicyDir();

  const superCommon = {
    DB_HOST: postgres.host,
    DB_PORT: String(postgres.port),
    DB_USERNAME: PG_SUPERUSER,
    DB_PASSWORD: PG_SUPERPASS,
    DB_SYNCHRONIZE: false,
    NODE_ENV: 'production' as const,
    DB_ENABLED: true,
    LOG_LEVEL: 'error' as const,
    PORT: 0,
  };

  // (2) Create the audit + expense databases via the bootstrap DB.
  const bootstrapDs = new DataSource({
    type: 'postgres',
    host: postgres.host,
    port: postgres.port,
    username: PG_SUPERUSER,
    password: PG_SUPERPASS,
    database: PG_BOOTSTRAP_DB,
  });
  await bootstrapDs.initialize();
  await ensureDatabase(bootstrapDs, 'audit');
  await ensureDatabase(bootstrapDs, 'expense');
  await bootstrapDs.destroy();

  // (3) Migrate all three DBs as the superuser. The OLTP migrations also provision
  // the unprivileged app roles from DB_APP_USERNAME/PASSWORD — set them here.
  const restoreAppRoles = withEnv({
    DB_APP_USERNAME: AUTHZ_APP_ROLE,
    DB_APP_PASSWORD: AUTHZ_APP_ROLE,
  });
  await runMigrations(authzAdminDsOptions({ ...superCommon, DB_DATABASE: 'authz_admin' } as never));
  restoreAppRoles();

  await runMigrations(auditDsOptions({ ...superCommon, DB_DATABASE: 'audit' } as never));

  const restoreExpenseRole = withEnv({
    DB_APP_USERNAME: EXPENSE_APP_ROLE,
    DB_APP_PASSWORD: EXPENSE_APP_ROLE,
  });
  await runMigrations(expenseDsOptions({ ...superCommon, DB_DATABASE: 'expense' } as never));
  restoreExpenseRole();

  // (4) Seed as the superuser (DDL/cross-tenant writes need the privileged role).
  const authzSeedDs = new DataSource(
    authzAdminDsOptions({ ...superCommon, DB_DATABASE: 'authz_admin' } as never),
  );
  await authzSeedDs.initialize();
  await seedAuthzAdmin(authzSeedDs);
  await authzSeedDs.destroy();

  const expenseSeedDs = new DataSource(
    expenseDsOptions({ ...superCommon, DB_DATABASE: 'expense' } as never),
  );
  await expenseSeedDs.initialize();
  await seedExpense(expenseSeedDs);
  await expenseSeedDs.destroy();

  // (5a) Boot the PAP (authz-admin) as the unprivileged role.
  const restorePapEnv = withEnv({
    NODE_ENV: 'production',
    PORT: '4000',
    LOG_LEVEL: 'error',
    DB_ENABLED: 'true',
    DB_HOST: postgres.host,
    DB_PORT: String(postgres.port),
    DB_USERNAME: AUTHZ_APP_ROLE,
    DB_PASSWORD: AUTHZ_APP_ROLE,
    DB_DATABASE: 'authz_admin',
    DB_SYNCHRONIZE: 'false',
    DB_APP_USERNAME: AUTHZ_APP_ROLE,
    DB_APP_PASSWORD: AUTHZ_APP_ROLE,
    CERBOS_PUBLISH_ENABLED: 'true',
    CERBOS_POLICY_DIR: policyDir,
    // Cerbos is not up yet (it starts after publish, step 5d); the PAP publishes by
    // WRITING a file (FsCerbosPolicyPublisher), so this URL is unused during publish.
    CERBOS_URL: '127.0.0.1:3593',
    // The PAP now VERIFIES the gateway-signed internal token (DESIGN §7) and refuses
    // to boot in production without the secret. Drive the production path with the
    // same shared secret/issuer the identity-token helper signs with.
    INTERNAL_TOKEN_SECRET,
    INTERNAL_TOKEN_ISSUER,
  });
  const pap = await bootApp(AuthzAdminAppModule, AuthzAdminFilter);
  restorePapEnv();

  // (5b) Boot the Audit service (single owning role; no RLS).
  const restoreAuditEnv = withEnv({
    NODE_ENV: 'production',
    PORT: '4000',
    LOG_LEVEL: 'error',
    DB_ENABLED: 'true',
    DB_HOST: postgres.host,
    DB_PORT: String(postgres.port),
    DB_USERNAME: PG_SUPERUSER,
    DB_PASSWORD: PG_SUPERPASS,
    DB_DATABASE: 'audit',
    DB_SYNCHRONIZE: 'false',
    // The audit READ endpoints now verify the gateway-signed internal token and
    // scope the decision log to the caller's tenant (DESIGN §6/§7); the service
    // refuses to boot in production without the secret. Same shared secret/issuer.
    INTERNAL_TOKEN_SECRET,
    INTERNAL_TOKEN_ISSUER,
  });
  const audit = await bootApp(AuditAppModule, AuditFilter);
  restoreAuditEnv();

  // (6) PUBLISH the demo policy through the PAP — BEFORE Cerbos starts. The PAP's
  // FsCerbosPolicyPublisher WRITES the compiled YAML into policyDir (a file write; it
  // does not need Cerbos running). The PAP derives tenant/actor from the VERIFIED
  // gateway-signed internal token (DESIGN §6/§7). (The runtime watch-based hot-reload
  // is covered end-to-end by the Playwright/compose suite; here we load the published
  // rule at Cerbos startup for deterministic, fsnotify-independent effectiveness.)
  const publishRes = await fetch(`${pap.url}/v1/policies`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...internalIdentityHeaders({ sub: 'dev', tid: TENANT_ACME }),
    },
    body: JSON.stringify({
      scope: SCOPE_ACME_FINANCE,
      rule: DEMO_EXPENSE_POLICY_RULE,
      effectiveDate: new Date().toISOString(),
    }),
  });
  if (!publishRes.ok) {
    throw new Error(
      `Demo policy publish failed: ${String(publishRes.status)} ${await publishRes.text()}`,
    );
  }

  // (5d) NOW start Cerbos with policyDir (platform defaults + the just-published
  // tenant rule) loaded at startup, so the rule is effective the moment it's healthy.
  const cerbos = await startCerbos(policyDir);

  // (5e) Boot the Expense PEP (unprivileged role), wired to the now-running REAL
  // Cerbos + the in-process PAP (PIP) + Audit (sink).
  const restoreExpenseEnv = withEnv({
    NODE_ENV: 'production',
    PORT: '4000',
    LOG_LEVEL: 'error',
    DB_ENABLED: 'true',
    DB_HOST: postgres.host,
    DB_PORT: String(postgres.port),
    DB_USERNAME: EXPENSE_APP_ROLE,
    DB_PASSWORD: EXPENSE_APP_ROLE,
    DB_DATABASE: 'expense',
    DB_SYNCHRONIZE: 'false',
    DB_APP_USERNAME: EXPENSE_APP_ROLE,
    DB_APP_PASSWORD: EXPENSE_APP_ROLE,
    CERBOS_URL: `${cerbos.host}:${String(cerbos.grpcPort)}`,
    PAP_URL: pap.url,
    AUDIT_URL: audit.url,
    // Drive the PRODUCTION internal-token signature-verification path (DESIGN §7):
    // the PEP verifies x-internal-identity-signature against this shared secret, the
    // same value the identity-token helper signs with.
    INTERNAL_TOKEN_SECRET,
    INTERNAL_TOKEN_ISSUER,
  });
  const expense = await bootApp(ExpenseAppModule, ExpenseFilter);
  restoreExpenseEnv();

  // Sanity gate: confirm the published acme.finance rule is effective (loaded at
  // Cerbos startup, so ~immediate; the poll also rides Cerbos warm-up).
  await waitForPolicyEffective(`http://${cerbos.host}:${String(cerbos.httpPort)}`);

  // Long-lived superuser + app DataSources for the RLS-isolation probes.
  const authzAdminSuperDs = new DataSource(
    authzAdminDsOptions({ ...superCommon, DB_DATABASE: 'authz_admin' } as never),
  );
  await authzAdminSuperDs.initialize();
  const authzAdminAppDs = new DataSource(
    authzAdminDsOptions({
      ...superCommon,
      DB_USERNAME: AUTHZ_APP_ROLE,
      DB_PASSWORD: AUTHZ_APP_ROLE,
      DB_DATABASE: 'authz_admin',
    } as never),
  );
  await authzAdminAppDs.initialize();
  const expenseSuperDs = new DataSource(
    expenseDsOptions({ ...superCommon, DB_DATABASE: 'expense' } as never),
  );
  await expenseSuperDs.initialize();
  const expenseAppDs = new DataSource(
    expenseDsOptions({
      ...superCommon,
      DB_USERNAME: EXPENSE_APP_ROLE,
      DB_PASSWORD: EXPENSE_APP_ROLE,
      DB_DATABASE: 'expense',
    } as never),
  );
  await expenseAppDs.initialize();

  return {
    papUrl: pap.url,
    auditUrl: audit.url,
    expenseUrl: expense.url,
    cerbos,
    postgres,
    authzAdminSuperDs,
    authzAdminAppDs,
    expenseSuperDs,
    expenseAppDs,
    stop: async (): Promise<void> => {
      await expenseAppDs.destroy();
      await expenseSuperDs.destroy();
      await authzAdminAppDs.destroy();
      await authzAdminSuperDs.destroy();
      await expense.app.close();
      await audit.app.close();
      await pap.app.close();
      await cerbos.stop();
      await postgres.stop();
    },
  };
}
