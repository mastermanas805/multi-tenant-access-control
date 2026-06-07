import { type DataSource, type QueryRunner } from 'typeorm';

import { TENANT_ACME, TENANT_GLOBEX } from './seed-data';

/**
 * Idempotent expense seed for the integration suite — the SAME demo expenses as
 * apps/expense/.../seed.ts (DESIGN §11), at the SAME scope (`acme.finance`) the
 * demo policy is published at:
 *   - exp_42  : $8,500  finance @ Acme   -> CASE (a) ALLOW
 *   - exp_99  : $25,000 finance @ Acme   -> CASE (b) DENY (amount < 10000 fails)
 *   - exp_glx : $4,200  ops     @ Globex -> CASE (c) DENY (tenant guardrail)
 *
 * Tenant-scoped rows are written inside a tenant-bound transaction so FORCED RLS
 * lets the writes through.
 */
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

export async function seedExpense(dataSource: DataSource): Promise<void> {
  const qr = dataSource.createQueryRunner();
  await qr.connect();
  try {
    await withTenant(qr, TENANT_ACME, async () => {
      await qr.query(
        `INSERT INTO "expenses"
           ("id","tenant_id","amount","currency","department","owner_id","status","description","scope","version")
         VALUES
           ('exp_42',$1,8500.00,'USD','finance','riya','pending','Q2 client dinner','acme.finance',1),
           ('exp_43',$1,9000.00,'USD','finance','riya','pending','Team lunch (revocation probe)','acme.finance',1),
           ('exp_99',$1,25000.00,'USD','finance','riya','pending','Offsite venue deposit','acme.finance',1)
         ON CONFLICT ("id") DO NOTHING`,
        [TENANT_ACME],
      );
    });
    await withTenant(qr, TENANT_GLOBEX, async () => {
      await qr.query(
        `INSERT INTO "expenses"
           ("id","tenant_id","amount","currency","department","owner_id","status","description","scope","version")
         VALUES
           ('exp_glx',$1,4200.00,'USD','ops','gframe','pending','Globex logistics','globex',1)
         ON CONFLICT ("id") DO NOTHING`,
        [TENANT_GLOBEX],
      );
    });
  } finally {
    await qr.release();
  }
}
