import { Module } from '@nestjs/common';

import { CreateOrgUnitUseCase } from './application/use-cases/create-org-unit.use-case';
import { GetOrgUnitUseCase } from './application/use-cases/get-org-unit.use-case';
import { ListSubtreeUseCase } from './application/use-cases/list-subtree.use-case';
import { MoveOrgUnitUseCase } from './application/use-cases/move-org-unit.use-case';
import { ORG_UNIT_REPOSITORY } from './domain/org-unit.repository.port';
import { TypeOrmOrgUnitRepository } from './infrastructure/typeorm-org-unit.repository';
import { OrgUnitController } from './presentation/org-unit.controller';

/**
 * Wires the OrgUnit feature module:
 *   - controller (presentation),
 *   - use-cases (application),
 *   - the repository PORT token -> its TypeORM adapter (infrastructure).
 *
 * The CLOCK port and TenantContextGuard come from the global SharedModule; the
 * DATA_SOURCE and TenantContextService come from the global DatabaseModule.
 * This replicates the Tenant module pattern exactly.
 */
@Module({
  controllers: [OrgUnitController],
  providers: [
    CreateOrgUnitUseCase,
    GetOrgUnitUseCase,
    ListSubtreeUseCase,
    MoveOrgUnitUseCase,
    { provide: ORG_UNIT_REPOSITORY, useClass: TypeOrmOrgUnitRepository },
  ],
  exports: [ORG_UNIT_REPOSITORY],
})
export class OrgUnitModule {}
