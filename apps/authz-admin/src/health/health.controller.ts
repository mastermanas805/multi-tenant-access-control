import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

import { ConfigService } from '../config/config.service';
import { DATA_SOURCE } from '../shared/infrastructure/database/data-source';

/**
 * Liveness/readiness endpoints. `/health` pings Postgres via Terminus when the
 * DB is enabled (DESIGN §8.9 reliability). Not tenant-scoped (no guard), so it
 * works for orchestrator probes. Version-neutral (no /v1 prefix).
 */
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly config: ConfigService,
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness + DB readiness probe' })
  public check(): Promise<HealthCheckResult> {
    if (!this.config.values.DB_ENABLED) {
      return this.health.check([]);
    }
    return this.health.check([
      () => this.db.pingCheck('database', { connection: this.dataSource, timeout: 1500 }),
    ]);
  }
}
