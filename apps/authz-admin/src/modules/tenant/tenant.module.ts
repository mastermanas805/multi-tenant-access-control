import { Module } from '@nestjs/common';

import { CreateTenantUseCase } from './application/use-cases/create-tenant.use-case';
import { GetTenantUseCase } from './application/use-cases/get-tenant.use-case';
import { ListTenantsUseCase } from './application/use-cases/list-tenants.use-case';
import { SuspendTenantUseCase } from './application/use-cases/suspend-tenant.use-case';
import { TENANT_REPOSITORY } from './domain/tenant.repository.port';
import { TypeOrmTenantRepository } from './infrastructure/typeorm-tenant.repository';
import { TenantController } from './presentation/tenant.controller';

/**
 * Wires the Tenant feature module:
 *   - controller (presentation),
 *   - use-cases (application),
 *   - the repository PORT token -> its TypeORM adapter (infrastructure).
 *
 * The CLOCK port and TenantContextGuard come from the global SharedModule; the
 * DATA_SOURCE and TenantContextService come from the global DatabaseModule.
 * This is the EXACT pattern every feature module replicates.
 */
@Module({
  controllers: [TenantController],
  providers: [
    CreateTenantUseCase,
    GetTenantUseCase,
    ListTenantsUseCase,
    SuspendTenantUseCase,
    { provide: TENANT_REPOSITORY, useClass: TypeOrmTenantRepository },
  ],
  exports: [TENANT_REPOSITORY],
})
export class TenantModule {}
