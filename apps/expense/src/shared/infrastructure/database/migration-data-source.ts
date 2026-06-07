import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { loadConfig } from '../../../config/config.schema';
import { buildDataSourceOptions } from './data-source';

/**
 * Stand-alone DataSource for the TypeORM CLI (`typeorm migration:run`,
 * `migration:generate`, `migration:revert`). The application itself builds its
 * DataSource through Nest DI (see database.module.ts); the CLI needs a default
 * export it can import directly, so this file rebuilds the SAME options from the
 * validated env (single source of truth) and forces `DB_ENABLED` on.
 *
 * Run via the package scripts, e.g.:
 *   pnpm --filter @app/expense run migration:run
 */
const config = loadConfig({ ...process.env, DB_ENABLED: 'true' });

export default new DataSource(buildDataSourceOptions(config));
