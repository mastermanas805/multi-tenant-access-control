import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ConfigService } from '../../../config/config.service';
import { assertRuntimeRoleEnforcesRls, createDataSource, DATA_SOURCE } from './data-source';
import { TenantContextService } from './tenant-context';

/**
 * Owns the DataSource lifecycle so the pool is closed on shutdown. Kept as a
 * provider (not the module class) so it can inject the DATA_SOURCE token cleanly.
 */
@Injectable()
class DataSourceLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  public async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}

/**
 * Provides a single, lazily-initialized TypeORM DataSource and the
 * TenantContextService. Global so every feature module's repository can inject
 * DATA_SOURCE and the tenant context without re-importing this module.
 *
 * When DB_ENABLED is false the DataSource is created but left uninitialized,
 * letting the HTTP layer (and pure-domain tests) boot without Postgres.
 */
@Global()
@Module({
  providers: [
    TenantContextService,
    DataSourceLifecycle,
    {
      provide: DATA_SOURCE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<DataSource> => {
        const dataSource = createDataSource(config.values);
        if (config.values.DB_ENABLED) {
          await dataSource.initialize();
          // Fail closed if the runtime role would bypass RLS (superuser /
          // BYPASSRLS), which silently defeats tenant isolation (DESIGN §6).
          await assertRuntimeRoleEnforcesRls(dataSource);
        }
        return dataSource;
      },
    },
  ],
  exports: [DATA_SOURCE, TenantContextService],
})
export class DatabaseModule {}
