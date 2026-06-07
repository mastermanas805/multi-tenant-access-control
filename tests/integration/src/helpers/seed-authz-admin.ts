import { type DataSource, type QueryRunner } from 'typeorm';

import { TENANT_ACME, TENANT_GLOBEX } from './seed-data';

/**
 * Idempotent authz_admin (PAP) seed for the integration suite — the SAME demo
 * data as apps/authz-admin/.../seed.ts (DESIGN §11): Acme/Globex tenants, the
 * permission catalog, the Acme roles, and the Riya/Sam/Dev assignments. Tenant-
 * scoped rows are written inside a tenant-bound transaction so FORCED RLS lets the
 * writes through; the global tables (tenants/permissions) are written directly.
 *
 * Riya is granted finance_manager at `acme.finance` (NOT a deeper sub-unit) so the
 * PIP resolves her role when the Expense PEP checks an `acme.finance` expense.
 */

const OU_ACME = '0a000000-0000-4000-8000-000000000001';
const OU_ACME_FINANCE = '0a000000-0000-4000-8000-000000000002';
const OU_GLOBEX = '0b000000-0000-4000-8000-000000000001';

const PERM_EXPENSE_READ = '0c000000-0000-4000-8000-000000000001';
const PERM_EXPENSE_APPROVE = '0c000000-0000-4000-8000-000000000002';

const ROLE_FINANCE_MANAGER = '0d000000-0000-4000-8000-000000000001';
const ROLE_ENGINEER = '0d000000-0000-4000-8000-000000000002';
const ROLE_ORG_ADMIN = '0d000000-0000-4000-8000-000000000003';

const ASSIGN_RIYA = '0e000000-0000-4000-8000-000000000001';
const ASSIGN_SAM = '0e000000-0000-4000-8000-000000000002';
const ASSIGN_DEV = '0e000000-0000-4000-8000-000000000003';

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

export async function seedAuthzAdmin(dataSource: DataSource): Promise<void> {
  const qr = dataSource.createQueryRunner();
  await qr.connect();
  try {
    // Global (no RLS): tenants + permission catalog.
    await qr.query(
      `INSERT INTO "tenants" ("id","name","slug","status","isolation_tier","version")
       VALUES ($1,'Acme','acme','active','pool',1),($2,'Globex','globex','active','silo',1)
       ON CONFLICT ("id") DO NOTHING`,
      [TENANT_ACME, TENANT_GLOBEX],
    );
    await qr.query(
      `INSERT INTO "permissions" ("id","key","description","version") VALUES
         ($1,'expense:report:read','Read expense reports',1),
         ($2,'expense:report:approve','Approve expense reports',1)
       ON CONFLICT ("id") DO NOTHING`,
      [PERM_EXPENSE_READ, PERM_EXPENSE_APPROVE],
    );

    // Acme (tenant-scoped).
    await withTenant(qr, TENANT_ACME, async () => {
      await qr.query(
        `INSERT INTO "org_units" ("id","tenant_id","parent_id","path","name","version") VALUES
           ($1,$2,NULL,'acme','Acme',1),
           ($3,$2,$1,'acme.finance','Finance',1)
         ON CONFLICT ("id") DO NOTHING`,
        [OU_ACME, TENANT_ACME, OU_ACME_FINANCE],
      );
      await qr.query(
        `INSERT INTO "roles" ("id","tenant_id","key","scope","description","version") VALUES
           ($1,$4,'finance_manager','acme.finance','Manage finance',1),
           ($2,$4,'engineer','acme','Engineering staff',1),
           ($3,$4,'org_admin','acme','Tenant administrator',1)
         ON CONFLICT ("id") DO NOTHING`,
        [ROLE_FINANCE_MANAGER, ROLE_ENGINEER, ROLE_ORG_ADMIN, TENANT_ACME],
      );
      await qr.query(
        `INSERT INTO "role_permissions" ("role_id","permission","tenant_id") VALUES
           ($1,'expense:report:read',$2),
           ($1,'expense:report:approve',$2)
         ON CONFLICT ("role_id","permission") DO NOTHING`,
        [ROLE_FINANCE_MANAGER, TENANT_ACME],
      );
      // Riya -> finance_manager @ acme.finance; Sam -> engineer @ acme; Dev -> org_admin @ acme.
      await qr.query(
        `INSERT INTO "role_assignments"
           ("id","tenant_id","user_id","role_id","scope","status","version") VALUES
           ($1,$7,'riya',$4,'acme.finance','active',1),
           ($2,$7,'sam',$5,'acme','active',1),
           ($3,$7,'dev',$6,'acme','active',1)
         ON CONFLICT ("id") DO NOTHING`,
        [
          ASSIGN_RIYA,
          ASSIGN_SAM,
          ASSIGN_DEV,
          ROLE_FINANCE_MANAGER,
          ROLE_ENGINEER,
          ROLE_ORG_ADMIN,
          TENANT_ACME,
        ],
      );
    });

    // Globex (tenant-scoped) — a root org unit + a role/assignment so the RLS
    // isolation probe has Globex rows in roles/role_assignments/org_units to NOT
    // leak into the Acme context.
    await withTenant(qr, TENANT_GLOBEX, async () => {
      await qr.query(
        `INSERT INTO "org_units" ("id","tenant_id","parent_id","path","name","version") VALUES
           ($1,$2,NULL,'globex','Globex',1)
         ON CONFLICT ("id") DO NOTHING`,
        [OU_GLOBEX, TENANT_GLOBEX],
      );
      await qr.query(
        `INSERT INTO "roles" ("id","tenant_id","key","scope","description","version") VALUES
           ('0d000000-0000-4000-8000-000000000099',$1,'ops_lead','globex','Globex ops',1)
         ON CONFLICT ("id") DO NOTHING`,
        [TENANT_GLOBEX],
      );
      await qr.query(
        `INSERT INTO "role_assignments"
           ("id","tenant_id","user_id","role_id","scope","status","version") VALUES
           ('0e000000-0000-4000-8000-000000000099',$1,'gframe',
            '0d000000-0000-4000-8000-000000000099','globex','active',1)
         ON CONFLICT ("id") DO NOTHING`,
        [TENANT_GLOBEX],
      );
    });
  } finally {
    await qr.release();
  }
}
