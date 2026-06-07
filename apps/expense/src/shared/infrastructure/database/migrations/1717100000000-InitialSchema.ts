import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Initial schema for the Expense (PEP) service.
 *
 * Creates the single business table `expenses` (DESIGN §4.3, §13) — the resource
 * the worked PEP example authorizes. It is TENANT-SCOPED, so it carries a
 * `tenant_id` column and ROW LEVEL SECURITY (DESIGN §6, ARCHITECTURE §5):
 *   ENABLE + FORCE RLS with a policy
 *     USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
 * The `true` (missing_ok) second arg makes the setting resolve to NULL when no
 * tenant context is bound instead of erroring; at request time the RlsInterceptor
 * sets it via `set_config('app.current_tenant', <tid>, true)`.
 *
 * The runtime API connects as the UNPRIVILEGED `expense_app` role
 * (NOSUPERUSER NOBYPASSRLS) so FORCE ROW LEVEL SECURITY is actually enforced — a
 * superuser/BYPASSRLS role would silently defeat isolation. This migration
 * provisions that role; migrations/seed still run as the privileged bootstrap user.
 */
export class InitialSchema1717100000000 implements MigrationInterface {
  public name = 'InitialSchema1717100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    // --- expenses (TENANT-SCOPED) -----------------------------------------
    await queryRunner.query(`
      CREATE TABLE "expenses" (
        "id"          varchar(64)   NOT NULL,
        "tenant_id"   uuid          NOT NULL,
        "amount"      numeric(14,2) NOT NULL,
        "currency"    varchar(3)    NOT NULL,
        "department"  varchar(100)  NOT NULL,
        "owner_id"    varchar(255)  NOT NULL,
        "status"      varchar(20)   NOT NULL,
        "description" varchar(1000) NOT NULL DEFAULT '',
        "scope"       varchar(255)  NOT NULL,
        "version"     integer       NOT NULL,
        "created_at"  timestamptz   NOT NULL DEFAULT now(),
        "updated_at"  timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_expenses" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE INDEX "ix_expenses_tenant" ON "expenses" ("tenant_id")');
    // (tenant_id, created_at, id) supports the RLS-scoped keyset list ordering.
    await queryRunner.query(
      'CREATE INDEX "ix_expenses_tenant_created" ON "expenses" ("tenant_id", "created_at", "id")',
    );

    // --- Row Level Security ------------------------------------------------
    if (isPostgres) {
      await queryRunner.query('ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY');
      // FORCE so the table owner (our connection role) is subject to RLS too.
      await queryRunner.query('ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY');
      await queryRunner.query(`
        CREATE POLICY "expenses_tenant_isolation" ON "expenses"
          USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
      `);

      // --- Application role (RLS is enforced against it) -------------------
      // A Postgres SUPERUSER (and any BYPASSRLS role) bypasses RLS *even with
      // FORCE enabled*. The default POSTGRES_USER is a superuser, so the app MUST
      // connect as a dedicated NOSUPERUSER NOBYPASSRLS role for tenant isolation
      // to hold. We provision it here; migrations/seed still run as the privileged
      // bootstrap user. Override the name/password via env if desired.
      const appRole = (process.env.DB_APP_USERNAME ?? 'expense_app').replace(/"/g, '');
      const appPassword = (process.env.DB_APP_PASSWORD ?? 'expense_app').replace(/'/g, "''");
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
            CREATE ROLE "${appRole}" LOGIN PASSWORD '${appPassword}'
              NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
          END IF;
        END
        $$;
      `);
      await queryRunner.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
      await queryRunner.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}"`,
      );
      await queryRunner.query(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRole}"`,
      );
      // Future tables/sequences created by this (bootstrap) role inherit grants.
      await queryRunner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public
           GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}"`,
      );
      await queryRunner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public
           GRANT USAGE, SELECT ON SEQUENCES TO "${appRole}"`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    if (isPostgres) {
      await queryRunner.query('DROP POLICY IF EXISTS "expenses_tenant_isolation" ON "expenses"');
    }
    await queryRunner.query('DROP TABLE IF EXISTS "expenses"');
  }
}
