import { Inject, Injectable } from '@nestjs/common';

import { type Clock, CLOCK } from '@kernel/core';

import { RoleAssignment } from '../../domain/role-assignment.entity';
import { RoleAssignmentAlreadyExistsError } from '../../domain/role-assignment.errors';
import {
  type RoleAssignmentRepository,
  ROLE_ASSIGNMENT_REPOSITORY,
} from '../../domain/role-assignment.repository.port';
import { ScopePath } from '../../domain/value-objects/scope-path.vo';
import { type AssignRoleCommand } from '../dto/role-assignment.commands';
import { type RoleAssignmentView, toRoleAssignmentView } from '../dto/role-assignment.view';

/**
 * Assigns a role to a user at an org-unit scope (DESIGN §8.2 — POST
 * /admin/v1/role-assignments). Enforces uniqueness of the active (user, role,
 * scope) triple, builds the aggregate (which applies its own invariants),
 * persists it, and returns the view.
 *
 * Depends only on the repository PORT token and the Clock port — no TypeORM,
 * no HTTP. Tenant-agnostic: RLS + the ambient context scope every row.
 */
@Injectable()
export class AssignRoleUseCase {
  constructor(
    @Inject(ROLE_ASSIGNMENT_REPOSITORY) private readonly assignments: RoleAssignmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: AssignRoleCommand): Promise<RoleAssignmentView> {
    const scope = ScopePath.fromString(command.scope);

    const existing = await this.assignments.findActiveAssignment(
      command.userId,
      command.roleId,
      scope.toString(),
    );
    if (existing) {
      throw new RoleAssignmentAlreadyExistsError(command.userId, command.roleId, scope.toString());
    }

    const assignment = RoleAssignment.create({
      tenantId: command.tenantId,
      userId: command.userId,
      roleId: command.roleId,
      scope,
      validUntil: command.validUntil ? new Date(command.validUntil) : null,
      delegatedBy: command.delegatedBy ?? null,
      now: this.clock.now(),
    });

    await this.assignments.save(assignment);

    return toRoleAssignmentView(assignment);
  }
}
