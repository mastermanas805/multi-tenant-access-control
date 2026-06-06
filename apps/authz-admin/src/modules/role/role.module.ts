import { Module } from '@nestjs/common';

import { AddPermissionToRoleUseCase } from './application/use-cases/add-permission-to-role.use-case';
import { CreateRoleUseCase } from './application/use-cases/create-role.use-case';
import { GetRoleUseCase } from './application/use-cases/get-role.use-case';
import { ListRolesUseCase } from './application/use-cases/list-roles.use-case';
import { RemovePermissionFromRoleUseCase } from './application/use-cases/remove-permission-from-role.use-case';
import { ROLE_REPOSITORY } from './domain/role.repository.port';
import { TypeOrmRoleRepository } from './infrastructure/typeorm-role.repository';
import { RoleController } from './presentation/role.controller';

/**
 * Wires the Role feature module:
 *   - controller (presentation),
 *   - use-cases (application),
 *   - the repository PORT token -> its TypeORM adapter (infrastructure).
 *
 * The CLOCK port and TenantContextGuard come from the global SharedModule; the
 * DATA_SOURCE and TenantContextService come from the global DatabaseModule.
 * This replicates the EXACT Tenant module pattern.
 */
@Module({
  controllers: [RoleController],
  providers: [
    CreateRoleUseCase,
    GetRoleUseCase,
    ListRolesUseCase,
    AddPermissionToRoleUseCase,
    RemovePermissionFromRoleUseCase,
    { provide: ROLE_REPOSITORY, useClass: TypeOrmRoleRepository },
  ],
  exports: [ROLE_REPOSITORY],
})
export class RoleModule {}
