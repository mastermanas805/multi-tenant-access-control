import { DataSource, type DataSourceOptions } from 'typeorm';

import { type AppConfig } from '../../../config/config.schema';

/** DI token for the TypeORM DataSource. */
export const DATA_SOURCE = Symbol('DATA_SOURCE');

/**
 * Builds TypeORM options from typed config. ORM entities are auto-discovered by
 * glob so feature modules only have to drop a `*.orm-entity.ts` file in their
 * infrastructure folder — no central registry to edit.
 */
export function buildDataSourceOptions(config: AppConfig): DataSourceOptions {
  return {
    type: 'postgres',
    host: config.DB_HOST,
    port: config.DB_PORT,
    username: config.DB_USERNAME,
    password: config.DB_PASSWORD,
    database: config.DB_DATABASE,
    synchronize: config.DB_SYNCHRONIZE,
    logging: config.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    // Compiled JS at runtime; .ts during ts-node/jest.
    entities: [__dirname + '/../../../modules/**/infrastructure/*.orm-entity.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    migrationsTableName: 'expense_migrations',
  };
}

/** Constructs (but does not initialize) a DataSource from config. */
export function createDataSource(config: AppConfig): DataSource {
  return new DataSource(buildDataSourceOptions(config));
}

/** Shape of the single row returned by the runtime-role privilege probe. */
interface RolePrivilegeRow {
  is_superuser: string;
  rolbypassrls: boolean;
}

/**
 * Fail-closed guard against the RLS superuser footgun (DESIGN §6 / §8.3).
 *
 * Postgres bypasses Row Level Security — even FORCE ROW LEVEL SECURITY — for any
 * SUPERUSER or BYPASSRLS role. If the long-running API connected as such a role,
 * tenant isolation would be SILENTLY defeated. The unprivileged `expense_app` role
 * provisioned by the migration is the intended runtime user; the privileged
 * bootstrap superuser is for migrations/seed ONLY.
 *
 * Run once against an initialized DataSource at boot (DB_ENABLED=true). REFUSES
 * TO BOOT (throws) if the runtime role is a superuser or has BYPASSRLS.
 */
export async function assertRuntimeRoleEnforcesRls(dataSource: DataSource): Promise<void> {
  const rows = await dataSource.query<RolePrivilegeRow[]>(
    `SELECT current_setting('is_superuser') AS is_superuser, rolbypassrls
       FROM pg_roles
      WHERE rolname = current_user`,
  );

  const row = rows[0];
  // No row for current_user is anomalous; fail closed rather than assume safe.
  if (!row) {
    throw new Error(
      'RLS safety check failed: could not read privileges for the runtime DB role ' +
        '(current_user not found in pg_roles). Refusing to boot.',
    );
  }

  // `is_superuser` is the text setting ('on'/'off'); `rolbypassrls` is a boolean.
  const isSuperuser = row.is_superuser === 'on';
  const bypassesRls = row.rolbypassrls;
  if (isSuperuser || bypassesRls) {
    const reason = isSuperuser ? 'is a SUPERUSER' : 'has BYPASSRLS';
    throw new Error(
      `RLS safety check failed: the runtime DB role ${reason}, which bypasses ` +
        'FORCE ROW LEVEL SECURITY and silently defeats tenant isolation. Connect ' +
        'the API as the unprivileged `expense_app` role (set DB_USERNAME/DB_PASSWORD); ' +
        'use the bootstrap superuser ONLY for migrations/seed. Refusing to boot.',
    );
  }
}
