import { Module } from '@nestjs/common';

import { AssignRoleUseCase } from './application/use-cases/assign-role.use-case';
import { ListAssignmentsForUserUseCase } from './application/use-cases/list-assignments-for-user.use-case';
import { RevokeRoleUseCase } from './application/use-cases/revoke-role.use-case';
import { ROLE_ASSIGNMENT_REPOSITORY } from './domain/role-assignment.repository.port';
import { TypeOrmRoleAssignmentRepository } from './infrastructure/typeorm-role-assignment.repository';
import { RoleAssignmentController } from './presentation/role-assignment.controller';

/**
 * Wires the RoleAssignment feature module:
 *   - controller (presentation),
 *   - use-cases (application),
 *   - the repository PORT token -> its TypeORM adapter (infrastructure).
 *
 * The CLOCK port, TenantContextGuard and the kernel DOMAIN_EVENT_DISPATCHER port
 * (-> LoggingDomainEventDispatcher) come from the global SharedModule; the
 * DATA_SOURCE and TenantContextService come from the global DatabaseModule.
 *
 * The dispatcher used to be bound here only, leaving the other modules' events
 * undispatched. It now lives in SharedModule so RevokeRoleUseCase and every other
 * event-raising flow share the SAME seam (DESIGN §3.4, FR-8).
 */
@Module({
  controllers: [RoleAssignmentController],
  providers: [
    AssignRoleUseCase,
    RevokeRoleUseCase,
    ListAssignmentsForUserUseCase,
    { provide: ROLE_ASSIGNMENT_REPOSITORY, useClass: TypeOrmRoleAssignmentRepository },
  ],
  exports: [ROLE_ASSIGNMENT_REPOSITORY],
})
export class RoleAssignmentModule {}
