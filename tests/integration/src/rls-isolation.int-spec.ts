import { type QueryRunner } from 'typeorm';

import { TENANT_ACME, TENANT_GLOBEX } from './helpers/seed-data';
import { type RunningStack, startStack } from './helpers/stack';

/**
 * REAL Postgres Row-Level-Security isolation (DESIGN §6 layer 1, the review's
 * explicit ask). Connecting as the UNPRIVILEGED `authz_app` role (NOSUPERUSER
 * NOBYPASSRLS) so FORCE ROW LEVEL SECURITY is actually enforced, we bind a tenant
 * via `set_config('app.current_tenant', ...)` — exactly what the RlsInterceptor
 * does per request — and assert each tenant sees ONLY its own rows across every
 * tenant-scoped table.
 */
describe('Postgres RLS tenant isolation (real DB, unprivileged role)', () => {
  let stack: RunningStack;
  let qr: QueryRunner;

  beforeAll(async () => {
    stack = await startStack();
    qr = stack.authzAdminAppDs.createQueryRunner();
    await qr.connect();
  }, 180_000);

  afterAll(async () => {
    await qr?.release();
    await stack?.stop();
  });

  /** Counts rows in `table` visible while bound to `tenantId` (RLS-scoped tx). */
  async function countAs(tenantId: string, table: string): Promise<number> {
    await qr.startTransaction();
    try {
      await qr.query('SELECT set_config($1, $2, true)', ['app.current_tenant', tenantId]);
      const rows = (await qr.query(`SELECT count(*)::text AS n FROM "${table}"`)) as {
        n: string;
      }[];
      return Number(rows[0]?.n ?? '0');
    } finally {
      await qr.commitTransaction();
    }
  }

  const tenantScopedTables = ['org_units', 'roles', 'role_assignments'] as const;

  it('confirms the unprivileged runtime role is NOT a superuser and does NOT bypass RLS', async () => {
    const rows = await stack.authzAdminAppDs.query<
      { is_superuser: string; rolbypassrls: boolean }[]
    >(
      `SELECT current_setting('is_superuser') AS is_superuser, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]?.is_superuser).toBe('off');
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it.each(tenantScopedTables)(
    'in the Acme tenant context, Postgres returns NO Globex rows for %s',
    async (table) => {
      const acmeCount = await countAs(TENANT_ACME, table);
      const globexCount = await countAs(TENANT_GLOBEX, table);

      // Both tenants have at least one row seeded in each table, so a non-isolated
      // query would see >= both. RLS makes each context see only its own.
      expect(acmeCount).toBeGreaterThan(0);
      expect(globexCount).toBeGreaterThan(0);

      // The Acme-context count must EQUAL the count of Acme-owned rows (no Globex
      // bleed): re-derive the Acme-owned count with an explicit superuser filter.
      const acmeOwned = await stack.authzAdminSuperDs.query<{ n: string }[]>(
        `SELECT count(*)::text AS n FROM "${table}" WHERE tenant_id = $1`,
        [TENANT_ACME],
      );
      expect(acmeCount).toBe(Number(acmeOwned[0]?.n ?? '0'));
    },
  );

  it('a query bound to Acme cannot read a specific Globex role row (explicit id probe)', async () => {
    await qr.startTransaction();
    try {
      await qr.query('SELECT set_config($1, $2, true)', ['app.current_tenant', TENANT_ACME]);
      const globexRole = (await qr.query(
        `SELECT id FROM "roles" WHERE id = '0d000000-0000-4000-8000-000000000099'`,
      )) as unknown[];
      expect(globexRole).toHaveLength(0);
    } finally {
      await qr.commitTransaction();
    }
  });

  it('in the Acme tenant context, the EXPENSE DB returns NO Globex expense rows', async () => {
    const expQr = stack.expenseAppDs.createQueryRunner();
    await expQr.connect();
    try {
      // Acme context: sees only Acme expenses, never the seeded Globex `exp_glx`.
      await expQr.startTransaction();
      await expQr.query('SELECT set_config($1, $2, true)', ['app.current_tenant', TENANT_ACME]);
      const acmeRows = (await expQr.query(`SELECT id FROM "expenses"`)) as { id: string }[];
      await expQr.commitTransaction();
      const acmeIds = acmeRows.map((r) => r.id);
      expect(acmeIds).toEqual(expect.arrayContaining(['exp_42']));
      expect(acmeIds).not.toContain('exp_glx');

      // Globex context: sees only the Globex expense, never the Acme ones.
      await expQr.startTransaction();
      await expQr.query('SELECT set_config($1, $2, true)', ['app.current_tenant', TENANT_GLOBEX]);
      const globexRows = (await expQr.query(`SELECT id FROM "expenses"`)) as { id: string }[];
      await expQr.commitTransaction();
      const globexIds = globexRows.map((r) => r.id);
      expect(globexIds).toContain('exp_glx');
      expect(globexIds).not.toContain('exp_42');
    } finally {
      await expQr.release();
    }
  });
});
