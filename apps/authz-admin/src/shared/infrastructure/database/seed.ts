import 'reflect-metadata';

import { type QueryRunner } from 'typeorm';

import { loadConfig } from '../../../config/config.schema';
import dataSource from './migration-data-source';

/**
 * Idempotent demo seed (DESIGN §11 demo data: Acme/Globex, Riya/Sam/Dev).
 *
 * Inserts, with FIXED UUIDs so the data is stable across runs and easy to curl:
 *   - tenants:          Acme (pool) + Globex (silo)
 *   - org units:        acme, acme.finance, acme.finance.emea, globex
 *   - permission catalog (global): expense:report:read / :approve,
 *                       payroll:run:execute, invoice:invoice:approve
 *   - roles (Acme):     finance_manager (scope acme.finance -> expense:report
 *                       read+approve), engineer, org_admin
 *   - role assignments: Riya -> finance_manager @ acme.finance,
 *                       Sam   -> engineer        @ acme,
 *                       Dev   -> org_admin       @ acme
 *
 * Riya is granted at `acme.finance` (the finance org unit) — the SAME scope the
 * demo `expense_report` policy is published at and the demo expenses carry — so
 * the PIP resolves her finance_manager role when the Expense PEP checks an
 * `acme.finance` expense (scope inheritance is ancestor-or-self; a grant at a
 * deeper `…emea` sub-unit would NOT apply to an `acme.finance` resource).
 *
 * Tenant-scoped tables are protected by FORCED RLS, so each tenant's rows are
 * written inside a transaction with `app.current_tenant` set to that tenant.
 * The global tables (tenants, permissions) have no RLS and are written directly.
 */

// --- Fixed UUIDs ---------------------------------------------------------
// These are FIXED (stable across runs, easy to curl) AND valid RFC-4122 v4
// (version nibble 4, variant nibble 8) — the domain id VOs and the tenant guard
// validate UUIDs strictly, so the demo data must pass that check. The leading
// byte encodes the type for readability: 0a=org-unit, 0c=permission, 0d=role,
// 0e=role-assignment; tenants use repeated-letter prefixes.
const TENANT_ACME = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_GLOBEX = 'bbbbbbbb-0000-4000-8000-000000000002';

const OU_ACME = '0a000000-0000-4000-8000-000000000001';
const OU_ACME_FINANCE = '0a000000-0000-4000-8000-000000000002';
const OU_ACME_FINANCE_EMEA = '0a000000-0000-4000-8000-000000000003';
const OU_GLOBEX = '0b000000-0000-4000-8000-000000000001';

const PERM_EXPENSE_READ = '0c000000-0000-4000-8000-000000000001';
const PERM_EXPENSE_APPROVE = '0c000000-0000-4000-8000-000000000002';
const PERM_PAYROLL_EXECUTE = '0c000000-0000-4000-8000-000000000003';
const PERM_INVOICE_APPROVE = '0c000000-0000-4000-8000-000000000004';

const ROLE_FINANCE_MANAGER = '0d000000-0000-4000-8000-000000000001';
const ROLE_ENGINEER = '0d000000-0000-4000-8000-000000000002';
const ROLE_ORG_ADMIN = '0d000000-0000-4000-8000-000000000003';

const ASSIGN_RIYA = '0e000000-0000-4000-8000-000000000001';
const ASSIGN_SAM = '0e000000-0000-4000-8000-000000000002';
const ASSIGN_DEV = '0e000000-0000-4000-8000-000000000003';

// The Identity service issues JWTs whose `sub` is a UUID (its UserId VO requires
// one). For the gateway -> Expense PEP flow to resolve end-to-end, we ALSO grant
// the same roles keyed by those user UUIDs (additive — the readable `riya`/`sam`/
// `dev` grants above still serve direct PEP calls). These UUIDs MUST match the
// Identity SEED_USERS ids (see docker-compose / apps/identity defaults).
const USER_UUID_RIYA = '11111111-1111-4111-8111-111111111111';
const USER_UUID_SAM = '22222222-2222-4222-8222-222222222222';
const USER_UUID_DEV = '33333333-3333-4333-8333-333333333333';
const ASSIGN_RIYA_UUID = '0e000000-0000-4000-8000-000000000011';
const ASSIGN_SAM_UUID = '0e000000-0000-4000-8000-000000000012';
const ASSIGN_DEV_UUID = '0e000000-0000-4000-8000-000000000013';

/** Runs `fn` inside a transaction scoped to a tenant so FORCED RLS lets writes through. */
async function withTenant(
  qr: QueryRunner,
  tenantId: string,
  fn: () => Promise<void>,
): Promise<void> {
  await qr.startTransaction();
  try {
    await qr.query('SELECT set_config($1, $2, true)', ['app.current_tenant', tenantId]);
    await fn();
    await qr.commitTransaction();
  } catch (err) {
    if (qr.isTransactionActive) {
      await qr.rollbackTransaction();
    }
    throw err;
  }
}

async function seedGlobal(qr: QueryRunner): Promise<void> {
  // Tenants (global, no RLS).
  await qr.query(
    `INSERT INTO "tenants" ("id","name","slug","status","isolation_tier","version")
     VALUES ($1,$2,$3,'active','pool',1),($4,$5,$6,'active','silo',1)
     ON CONFLICT ("id") DO NOTHING`,
    [TENANT_ACME, 'Acme', 'acme', TENANT_GLOBEX, 'Globex', 'globex'],
  );

  // Permission catalog (global, no RLS).
  await qr.query(
    `INSERT INTO "permissions" ("id","key","description","version") VALUES
       ($1,'expense:report:read','Read expense reports',1),
       ($2,'expense:report:approve','Approve expense reports',1),
       ($3,'payroll:run:execute','Execute a payroll run',1),
       ($4,'invoice:invoice:approve','Approve an invoice',1)
     ON CONFLICT ("id") DO NOTHING`,
    [PERM_EXPENSE_READ, PERM_EXPENSE_APPROVE, PERM_PAYROLL_EXECUTE, PERM_INVOICE_APPROVE],
  );
}

async function seedAcme(qr: QueryRunner): Promise<void> {
  await withTenant(qr, TENANT_ACME, async () => {
    // Org units: acme -> acme.finance -> acme.finance.emea
    await qr.query(
      `INSERT INTO "org_units" ("id","tenant_id","parent_id","path","name","version") VALUES
         ($1,$2,NULL,'acme','Acme',1),
         ($3,$2,$1,'acme.finance','Finance',1),
         ($4,$2,$3,'acme.finance.emea','Finance EMEA',1)
       ON CONFLICT ("id") DO NOTHING`,
      [OU_ACME, TENANT_ACME, OU_ACME_FINANCE, OU_ACME_FINANCE_EMEA],
    );

    // Roles
    await qr.query(
      `INSERT INTO "roles" ("id","tenant_id","key","scope","description","version") VALUES
         ($1,$4,'finance_manager','acme.finance','Manage finance — read/approve expense reports',1),
         ($2,$4,'engineer','acme','Engineering staff',1),
         ($3,$4,'org_admin','acme','Tenant organization administrator',1)
       ON CONFLICT ("id") DO NOTHING`,
      [ROLE_FINANCE_MANAGER, ROLE_ENGINEER, ROLE_ORG_ADMIN, TENANT_ACME],
    );

    // role_permissions: finance_manager -> expense:report:read + approve
    await qr.query(
      `INSERT INTO "role_permissions" ("role_id","permission","tenant_id") VALUES
         ($1,'expense:report:read',$2),
         ($1,'expense:report:approve',$2)
       ON CONFLICT ("role_id","permission") DO NOTHING`,
      [ROLE_FINANCE_MANAGER, TENANT_ACME],
    );

    // role assignments (Acme): Riya/Sam/Dev — keyed by the readable ids (direct
    // PEP calls) AND by the Identity user UUIDs (the gateway -> PEP flow, where the
    // JWT `sub` is the UUID). Both resolve to the same effective roles.
    await qr.query(
      `INSERT INTO "role_assignments"
         ("id","tenant_id","user_id","role_id","scope","status","version") VALUES
         ($1,$7,'riya',$4,'acme.finance','active',1),
         ($2,$7,'sam',$5,'acme','active',1),
         ($3,$7,'dev',$6,'acme','active',1),
         ($8,$7,$11,$4,'acme.finance','active',1),
         ($9,$7,$12,$5,'acme','active',1),
         ($10,$7,$13,$6,'acme','active',1)
       ON CONFLICT ("id") DO NOTHING`,
      [
        ASSIGN_RIYA,
        ASSIGN_SAM,
        ASSIGN_DEV,
        ROLE_FINANCE_MANAGER,
        ROLE_ENGINEER,
        ROLE_ORG_ADMIN,
        TENANT_ACME,
        ASSIGN_RIYA_UUID,
        ASSIGN_SAM_UUID,
        ASSIGN_DEV_UUID,
        USER_UUID_RIYA,
        USER_UUID_SAM,
        USER_UUID_DEV,
      ],
    );
  });
}

async function seedGlobex(qr: QueryRunner): Promise<void> {
  await withTenant(qr, TENANT_GLOBEX, async () => {
    // Org unit: globex (root) — demonstrates the silo tenant + cross-tenant isolation.
    await qr.query(
      `INSERT INTO "org_units" ("id","tenant_id","parent_id","path","name","version") VALUES
         ($1,$2,NULL,'globex','Globex',1)
       ON CONFLICT ("id") DO NOTHING`,
      [OU_GLOBEX, TENANT_GLOBEX],
    );
  });
}

async function run(): Promise<void> {
  // Force DB on for the CLI even if the ambient .env disables it for tests.
  loadConfig({ ...process.env, DB_ENABLED: 'true' });

  await dataSource.initialize();
  const qr = dataSource.createQueryRunner();
  await qr.connect();
  try {
    await seedGlobal(qr);
    await seedAcme(qr);
    await seedGlobex(qr);
    // eslint-disable-next-line no-console
    console.log(
      'Seed complete: tenants Acme(pool)/Globex(silo), 4 org units, 4 permissions, 3 roles, 3 assignments.',
    );
  } finally {
    await qr.release();
    await dataSource.destroy();
  }
}

run().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
