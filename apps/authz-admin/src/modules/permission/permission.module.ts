import { Module } from '@nestjs/common';

import { CreatePermissionUseCase } from './application/use-cases/create-permission.use-case';
import { GetPermissionUseCase } from './application/use-cases/get-permission.use-case';
import { ListPermissionsUseCase } from './application/use-cases/list-permissions.use-case';
import { PERMISSION_REPOSITORY } from './domain/permission.repository.port';
import { TypeOrmPermissionRepository } from './infrastructure/typeorm-permission.repository';
import { PermissionController } from './presentation/permission.controller';

/**
 * Wires the Permission feature module:
 *   - controller (presentation),
 *   - use-cases (application),
 *   - the repository PORT token -> its TypeORM adapter (infrastructure).
 *
 * The CLOCK port and TenantContextGuard come from the global SharedModule; the
 * DATA_SOURCE and TenantContextService come from the global DatabaseModule.
 * This is the EXACT pattern every feature module replicates.
 */
@Module({
  controllers: [PermissionController],
  providers: [
    CreatePermissionUseCase,
    GetPermissionUseCase,
    ListPermissionsUseCase,
    { provide: PERMISSION_REPOSITORY, useClass: TypeOrmPermissionRepository },
  ],
  exports: [PERMISSION_REPOSITORY],
})
export class PermissionModule {}
