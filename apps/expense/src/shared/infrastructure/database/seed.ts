import 'reflect-metadata';

import { type QueryRunner } from 'typeorm';

import { loadConfig } from '../../../config/config.schema';
import dataSource from './migration-data-source';

/**
 * Idempotent demo seed for the worked PEP example (DESIGN §11, §4.3). Inserts the
 * three demo expenses the live Cerbos cases exercise, with FIXED ids so they are
 * stable across runs and easy to curl. The tenant UUIDs match the authz-admin
 * seed (Acme / Globex) so the same internal identity token resolves end-to-end.
 *
 *   - exp_42  : $8,500  finance @ Acme   (owner riya,  scope acme.finance)
 *               -> CASE 1: finance_manager read/approve ALLOW (same-dept, < 10000)
 *   - exp_43  : $1,200  finance @ Acme   (owner riya,  scope acme.finance)
 *               -> CASE 1b: a SECOND pending expense reserved for the FR-8 live
 *                  role-flip demo (approve DENIED after revoke, ALLOWED after
 *                  re-grant) — kept separate so the happy-path approve of exp_42
 *                  doesn't consume it
 *   - exp_99  : $25,000 finance @ Acme   (owner riya,  scope acme.finance)
 *               -> CASE 2: approve DENY (ABAC amount < 10000 fails)
 *   - exp_glx : $4,200  ops     @ Globex (owner gframe, scope globex)
 *               -> CASE 3: an Acme principal is DENIED by the tenant guardrail
 *   - exp_gx1 : $3,200  ops     @ Globex (owner gwen,  scope globex.ops)
 *               -> CASE 4: ops_manager read/approve ALLOW (same-dept, < 10000) —
 *                  the SECOND client enforcing its OWN runtime policy
 *   - exp_gx2 : $42,000 ops     @ Globex (owner gwen,  scope globex.ops)
 *               -> CASE 5: approve DENY (ABAC amount < 10000 fails) on Globex
 *
 * Tenant-scoped rows are written inside a transaction with `app.current_tenant`
 * set to that tenant so FORCED RLS lets the writes through.
 */

// Tenant UUIDs — MUST match the authz-admin seed (Acme/Globex).
const TENANT_ACME = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_GLOBEX = 'bbbbbbbb-0000-4000-8000-000000000002';

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

async function seedAcme(qr: QueryRunner): Promise<void> {
  await withTenant(qr, TENANT_ACME, async () => {
    await qr.query(
      `INSERT INTO "expenses"
         ("id","tenant_id","amount","currency","department","owner_id","status","description","scope","version")
       VALUES
         ('exp_42',$1,8500.00,'USD','finance','riya','pending','Q2 client dinner — EMEA roadshow','acme.finance',1),
         ('exp_43',$1,1200.00,'USD','finance','riya','pending','Team offsite taxis — FR-8 live-flip demo','acme.finance',1),
         ('exp_99',$1,25000.00,'USD','finance','riya','pending','Annual offsite venue deposit','acme.finance',1)
       ON CONFLICT ("id") DO NOTHING`,
      [TENANT_ACME],
    );
  });
}

async function seedGlobex(qr: QueryRunner): Promise<void> {
  await withTenant(qr, TENANT_GLOBEX, async () => {
    await qr.query(
      `INSERT INTO "expenses"
         ("id","tenant_id","amount","currency","department","owner_id","status","description","scope","version")
       VALUES
         ('exp_glx',$1,4200.00,'USD','ops','gframe','pending','Globex logistics — cross-tenant isolation demo','globex',1),
         ('exp_gx1',$1,3200.00,'USD','ops','gwen','pending','Globex ops — courier run (Gwen approves)','globex.ops',1),
         ('exp_gx2',$1,42000.00,'USD','ops','gwen','pending','Globex ops — warehouse lease deposit','globex.ops',1)
       ON CONFLICT ("id") DO NOTHING`,
      [TENANT_GLOBEX],
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
    await seedAcme(qr);
    await seedGlobex(qr);
    // eslint-disable-next-line no-console
    console.log(
      'Seed complete: exp_42 ($8.5k finance@Acme), exp_43 ($1.2k finance@Acme, FR-8 demo), ' +
        'exp_99 ($25k finance@Acme), exp_glx ($4.2k ops@Globex), ' +
        'exp_gx1 ($3.2k ops@Globex.ops), exp_gx2 ($42k ops@Globex.ops).',
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
