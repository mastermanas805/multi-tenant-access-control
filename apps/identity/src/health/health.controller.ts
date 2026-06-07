import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * Liveness/readiness endpoint for orchestrator probes. The identity service is
 * stateless (config-seeded, no DB), so the check has no dependency indicators —
 * a 200 means the process is up and the signing key loaded at boot. Version-
 * neutral (no /v1 prefix). DESIGN §8.9.
 */
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe' })
  public check(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
