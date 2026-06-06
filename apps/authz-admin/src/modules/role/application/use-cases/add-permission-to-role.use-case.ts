import { Inject, Injectable } from '@nestjs/common';

import {
  ConflictError,
  type Clock,
  CLOCK,
  type IDomainEventDispatcher,
  DOMAIN_EVENT_DISPATCHER,
} from '@kernel/core';

import { RoleNotFoundError } from '../../domain/role.errors';
import { type RoleRepository, ROLE_REPOSITORY } from '../../domain/role.repository.port';
import { RoleId } from '../../domain/value-objects/role-id.vo';
import { type AddPermissionToRoleCommand } from '../dto/role.commands';
import { type RoleView, toRoleView } from '../dto/role.view';

/**
 * Grants a permission to a role. Honors optimistic concurrency (DESIGN §8.1):
 * when the caller supplies an expected version (from the `If-Match` ETag) it must
 * match the loaded aggregate, else a ConflictError (-> 409) is raised. The
 * aggregate records a RolePermissionAddedEvent which the dispatcher publishes
 * after save (drives PIP cache invalidation — FR-8).
 */
@Injectable()
export class AddPermissionToRoleUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DOMAIN_EVENT_DISPATCHER) private readonly dispatcher: IDomainEventDispatcher,
  ) {}

  public async execute(command: AddPermissionToRoleCommand): Promise<RoleView> {
    const id = RoleId.fromString(command.roleId);
    const role = await this.roles.findById(id);
    if (!role) {
      throw new RoleNotFoundError(command.roleId);
    }

    if (command.expectedVersion !== undefined && command.expectedVersion !== role.version) {
      throw new ConflictError('Role was modified by another request', 'version_mismatch');
    }

    role.addPermission(command.permission, this.clock.now());
    await this.roles.save(role);

    // Publish RolePermissionAddedEvent after persistence so the PIP cache is told
    // to invalidate only once the grant is durable (DESIGN §3.4, FR-8).
    await this.dispatcher.dispatch(role.pullDomainEvents());

    return toRoleView(role);
  }
}
