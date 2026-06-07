import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ConfigService } from '../../../config/config.service';
import { createDataSource, DATA_SOURCE } from './data-source';

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
 * Provides a single, lazily-initialized TypeORM DataSource. Global so the audit
 * feature module's repository can inject DATA_SOURCE without re-importing.
 *
 * When DB_ENABLED is false the DataSource is created but left uninitialized,
 * letting the HTTP layer (and in-memory tests) boot without Postgres.
 */
@Global()
@Module({
  providers: [
    DataSourceLifecycle,
    {
      provide: DATA_SOURCE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<DataSource> => {
        const dataSource = createDataSource(config.values);
        if (config.values.DB_ENABLED) {
          await dataSource.initialize();
        }
        return dataSource;
      },
    },
  ],
  exports: [DATA_SOURCE],
})
export class DatabaseModule {}
