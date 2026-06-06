import { Inject, Injectable } from '@nestjs/common';

import {
  ConflictError,
  type Clock,
  CLOCK,
  type IDomainEventDispatcher,
  DOMAIN_EVENT_DISPATCHER,
} from '@kernel/core';

import { RoleAssignmentNotFoundError } from '../../domain/role-assignment.errors';
import {
  type RoleAssignmentRepository,
  ROLE_ASSIGNMENT_REPOSITORY,
} from '../../domain/role-assignment.repository.port';
import { RoleAssignmentId } from '../../domain/value-objects/role-assignment-id.vo';
import { type RevokeRoleCommand } from '../dto/role-assignment.commands';
import { type RoleAssignmentView, toRoleAssignmentView } from '../dto/role-assignment.view';

/**
 * Revokes a role assignment (DESIGN §8.2 — DELETE /admin/v1/role-assignments/:id).
 *
 * This is the dynamic-management seam (DESIGN §3.4, FR-8): the aggregate records a
 * RoleAssignmentRevokedEvent which this use-case pulls AFTER persistence and hands
 * to the kernel IDomainEventDispatcher. The bound event-bus adapter then
 * invalidates the affected principal's PIP cache, so the next authorization check
 * fetches fresh roles and the revoked access becomes a DENY within seconds.
 *
 * Honors optimistic concurrency (DESIGN §8.1): when the caller supplies an
 * expected version (from the `If-Match` ETag) it must match the loaded aggregate,
 * else a ConflictError (-> 409) is raised.
 */
@Injectable()
export class RevokeRoleUseCase {
  constructor(
    @Inject(ROLE_ASSIGNMENT_REPOSITORY) private readonly assignments: RoleAssignmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DOMAIN_EVENT_DISPATCHER) private readonly dispatcher: IDomainEventDispatcher,
  ) {}

  public async execute(command: RevokeRoleCommand): Promise<RoleAssignmentView> {
    const id = RoleAssignmentId.fromString(command.roleAssignmentId);
    const assignment = await this.assignments.findById(id);
    if (!assignment) {
      throw new RoleAssignmentNotFoundError(command.roleAssignmentId);
    }

    if (command.expectedVersion !== undefined && command.expectedVersion !== assignment.version) {
      throw new ConflictError(
        'Role assignment was modified by another request',
        'version_mismatch',
      );
    }

    assignment.revoke(this.clock.now());
    await this.assignments.save(assignment);

    // Publish after persistence so the source of truth is committed before the
    // PIP cache is told to invalidate (DESIGN §3.4 sequence).
    await this.dispatcher.dispatch(assignment.pullDomainEvents());

    return toRoleAssignmentView(assignment);
  }
}
