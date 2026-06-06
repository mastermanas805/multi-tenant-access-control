import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Initial schema for the Authorization Admin (PAP) service.
 *
 * Creates every table in the DESIGN §8 data model with the correct columns,
 * foreign keys, and the hot-path indexes from DESIGN §8.6:
 *   - role_assignments(tenant_id,user_id) and (tenant_id,role_id)
 *   - org_units path index (ltree + GiST when the extension is available;
 *     otherwise a text_pattern_ops btree so `LIKE 'root.%'` subtree scans stay
 *     indexed — DESIGN §8.5)
 *   - roles(tenant_id,key) UNIQUE
 *   - permissions(key) UNIQUE (global catalog)
 *   - policies(tenant_id,scope,version) UNIQUE
 *
 * Multi-tenant isolation (DESIGN §6, ARCHITECTURE §5): every TENANT-SCOPED table
 * has ROW LEVEL SECURITY ENABLED + FORCED with a policy
 *   USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
 * The `true` (missing_ok) second arg makes the setting resolve to NULL when no
 * tenant context is bound (migrations, jobs) instead of erroring; at request time
 * the RlsInterceptor sets it via `set_config('app.current_tenant', <tid>, true)`.
 *
 * The `tenants` and `permissions` tables are the GLOBAL exception: they carry no
 * tenant_id and have NO RLS (a tenant row IS the boundary; permissions are a
 * platform-wide capability catalog).
 */
export class InitialSchema1717000000000 implements MigrationInterface {
  public name = 'InitialSchema1717000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    // Extensions:
    //   - ltree     powers indexed org-tree subtree queries (DESIGN §8.5).
    //   - btree_gist lets a uuid column (tenant_id) sit in the SAME composite
    //                GiST index as the ltree path expression, so the index is
    //                tenant-scoped and subtree-prefixed in one shot.
    //   - pgcrypto  handy for ad-hoc gen_random_uuid() in psql; best-effort.
    let hasLtree = false;
    let hasBtreeGist = false;
    if (isPostgres) {
      try {
        await queryRunner.query('CREATE EXTENSION IF NOT EXISTS ltree');
        hasLtree = true;
      } catch {
        hasLtree = false;
      }
      try {
        await queryRunner.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
        hasBtreeGist = true;
      } catch {
        hasBtreeGist = false;
      }
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto').catch(() => undefined);
    }

    // --- tenants (GLOBAL — no tenant_id, no RLS) ---------------------------
    await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id"             uuid        NOT NULL,
        "name"           varchar(200) NOT NULL,
        "slug"           varchar(100) NOT NULL,
        "status"         varchar(20)  NOT NULL,
        "isolation_tier" varchar(20)  NOT NULL,
        "version"        integer      NOT NULL,
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        "updated_at"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tenants" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "uq_tenants_slug" ON "tenants" ("slug")');

    // --- permissions (GLOBAL catalog — no tenant_id, no RLS) ---------------
    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id"          uuid         NOT NULL,
        "key"         varchar(150) NOT NULL,
        "description" varchar(500) NOT NULL,
        "version"     integer      NOT NULL,
        "created_at"  timestamptz  NOT NULL DEFAULT now(),
        "updated_at"  timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_permissions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "uq_permissions_key" ON "permissions" ("key")');

    // --- org_units (TENANT-SCOPED) ----------------------------------------
    await queryRunner.query(`
      CREATE TABLE "org_units" (
        "id"         uuid          NOT NULL,
        "tenant_id"  uuid          NOT NULL,
        "parent_id"  uuid          NULL,
        "path"       varchar(1024) NOT NULL,
        "name"       varchar(200)  NOT NULL,
        "version"    integer       NOT NULL,
        "created_at" timestamptz   NOT NULL DEFAULT now(),
        "updated_at" timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_org_units" PRIMARY KEY ("id"),
        CONSTRAINT "fk_org_units_parent"
          FOREIGN KEY ("parent_id") REFERENCES "org_units" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_org_units_tenant_path" ON "org_units" ("tenant_id", "path")',
    );
    if (hasLtree && hasBtreeGist) {
      // Composite GiST over (tenant_id, ltree(path)) so subtree queries (`<@`)
      // and prefix scans are indexed AND tenant-scoped (DESIGN §8.5). btree_gist
      // supplies the uuid operator class. The column stays varchar for
      // portability; the index materializes the ltree view of the path.
      await queryRunner.query(
        `CREATE INDEX "ix_org_units_tenant_path_gist" ON "org_units"
           USING GIST ("tenant_id", (text2ltree(replace("path", '-', '_'))))`,
      );
    } else if (hasLtree) {
      // ltree without btree_gist: GiST on the ltree expression alone, plus a
      // plain btree on tenant_id so queries still narrow by tenant first.
      await queryRunner.query(
        `CREATE INDEX "ix_org_units_path_gist" ON "org_units"
           USING GIST ((text2ltree(replace("path", '-', '_'))))`,
      );
      await queryRunner.query('CREATE INDEX "ix_org_units_tenant" ON "org_units" ("tenant_id")');
    } else {
      // No ltree: text_pattern_ops btree keeps `LIKE 'root.%'` subtree scans
      // indexed and tenant-scoped.
      await queryRunner.query(
        `CREATE INDEX "ix_org_units_tenant_path_prefix" ON "org_units"
           ("tenant_id", "path" text_pattern_ops)`,
      );
    }

    // --- roles (TENANT-SCOPED) --------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id"          uuid         NOT NULL,
        "tenant_id"   uuid         NOT NULL,
        "key"         varchar(100) NOT NULL,
        "scope"       varchar(255) NOT NULL,
        "description" varchar(500) NOT NULL DEFAULT '',
        "version"     integer      NOT NULL,
        "created_at"  timestamptz  NOT NULL DEFAULT now(),
        "updated_at"  timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_roles" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_roles_tenant_key" ON "roles" ("tenant_id", "key")',
    );

    // --- role_permissions (TENANT-SCOPED owned child of roles) -------------
    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "role_id"    uuid         NOT NULL,
        "permission" varchar(255) NOT NULL,
        "tenant_id"  uuid         NOT NULL,
        CONSTRAINT "pk_role_permissions" PRIMARY KEY ("role_id", "permission"),
        CONSTRAINT "fk_role_permissions_role"
          FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_role_permissions_tenant" ON "role_permissions" ("tenant_id")',
    );

    // --- role_assignments (TENANT-SCOPED) ---------------------------------
    await queryRunner.query(`
      CREATE TABLE "role_assignments" (
        "id"           uuid         NOT NULL,
        "tenant_id"    uuid         NOT NULL,
        "user_id"      varchar(255) NOT NULL,
        "role_id"      varchar(255) NOT NULL,
        "scope"        varchar(255) NOT NULL,
        "status"       varchar(20)  NOT NULL,
        "valid_until"  timestamptz  NULL,
        "delegated_by" varchar(255) NULL,
        "version"      integer      NOT NULL,
        "created_at"   timestamptz  NOT NULL DEFAULT now(),
        "updated_at"   timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_role_assignments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "ix_role_assignments_tenant_user" ON "role_assignments" ("tenant_id", "user_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "ix_role_assignments_tenant_role" ON "role_assignments" ("tenant_id", "role_id")',
    );

    // --- policies (TENANT-SCOPED) -----------------------------------------
    await queryRunner.query(`
      CREATE TABLE "policies" (
        "id"             uuid         NOT NULL,
        "tenant_id"      uuid         NOT NULL,
        "scope"          varchar(255) NOT NULL,
        "rule"           jsonb        NOT NULL,
        "status"         varchar(20)  NOT NULL,
        "version"        integer      NOT NULL,
        "effective_date" timestamptz  NOT NULL,
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        "updated_at"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_policies" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_policies_scope_version" ON "policies" ("tenant_id", "scope", "version")',
    );
    await queryRunner.query('CREATE INDEX "ix_policies_scope" ON "policies" ("scope")');

    // --- Row Level Security on every TENANT-SCOPED table -------------------
    if (isPostgres) {
      const tenantScoped = [
        'org_units',
        'roles',
        'role_permissions',
        'role_assignments',
        'policies',
      ];
      for (const table of tenantScoped) {
        await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
        // FORCE so the table owner (our connection role) is subject to RLS too.
        await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
        await queryRunner.query(`
          CREATE POLICY "${table}_tenant_isolation" ON "${table}"
            USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        `);
      }

      // --- Application role (RLS is enforced against it) -------------------
      // CRITICAL: a Postgres SUPERUSER (and any role with BYPASSRLS) bypasses
      // RLS *even with FORCE enabled*. The default POSTGRES_USER is a superuser,
      // so the app MUST connect as a dedicated NOSUPERUSER NOBYPASSRLS role for
      // tenant isolation to actually hold. We provision that role here so the
      // demo is self-contained; migrations/seed still run as the privileged
      // bootstrap user. Override the name/password via env if desired.
      const appRole = (process.env.DB_APP_USERNAME ?? 'authz_app').replace(/"/g, '');
      const appPassword = (process.env.DB_APP_PASSWORD ?? 'authz_app').replace(/'/g, "''");
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
      const tenantScoped = [
        'policies',
        'role_assignments',
        'role_permissions',
        'roles',
        'org_units',
      ];
      for (const table of tenantScoped) {
        await queryRunner.query(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${table}"`);
      }
    }
    await queryRunner.query('DROP TABLE IF EXISTS "policies"');
    await queryRunner.query('DROP TABLE IF EXISTS "role_assignments"');
    await queryRunner.query('DROP TABLE IF EXISTS "role_permissions"');
    await queryRunner.query('DROP TABLE IF EXISTS "roles"');
    await queryRunner.query('DROP TABLE IF EXISTS "org_units"');
    await queryRunner.query('DROP TABLE IF EXISTS "permissions"');
    await queryRunner.query('DROP TABLE IF EXISTS "tenants"');
  }
}
