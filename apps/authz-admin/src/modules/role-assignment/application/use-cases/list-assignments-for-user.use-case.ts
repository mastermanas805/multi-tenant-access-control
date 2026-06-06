import { Inject, Injectable } from '@nestjs/common';

import { PageQuery } from '@kernel/core';

import {
  type RoleAssignmentRepository,
  ROLE_ASSIGNMENT_REPOSITORY,
} from '../../domain/role-assignment.repository.port';
import { type ListAssignmentsForUserQuery } from '../dto/role-assignment.commands';
import { type RoleAssignmentPageView, toRoleAssignmentPageView } from '../dto/role-assignment.view';

/**
 * Cursor-paginated listing of a single user's role assignments within the tenant
 * (DESIGN §8.6 hot query: role_assignments(tenant_id,user_id)).
 */
@Injectable()
export class ListAssignmentsForUserUseCase {
  constructor(
    @Inject(ROLE_ASSIGNMENT_REPOSITORY) private readonly assignments: RoleAssignmentRepository,
  ) {}

  public async execute(query: ListAssignmentsForUserQuery): Promise<RoleAssignmentPageView> {
    const page = PageQuery.from({ limit: query.limit, cursor: query.cursor });
    const result = await this.assignments.listForUser(query.userId, page);
    return toRoleAssignmentPageView(result);
  }
}
