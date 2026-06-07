import { DataSource, type DataSourceOptions } from 'typeorm';

import { type AppConfig } from '../../../config/config.schema';

/** DI token for the TypeORM DataSource. */
export const DATA_SOURCE = Symbol('DATA_SOURCE');

/**
 * Builds TypeORM options from typed config. ORM entities are auto-discovered by
 * glob so feature modules only have to drop a `*.orm-entity.ts` file in their
 * infrastructure folder — no central registry to edit.
 *
 * NOTE: the audit log is the compliance system of record and lives in its OWN
 * database (DESIGN §8.7 / App. C — "Never in the OLTP DB"). There is no per-tenant
 * RLS here: the single table is append-only and written only by this service.
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
    migrationsTableName: 'audit_migrations',
  };
}

/** Constructs (but does not initialize) a DataSource from config. */
export function createDataSource(config: AppConfig): DataSource {
  return new DataSource(buildDataSourceOptions(config));
}
