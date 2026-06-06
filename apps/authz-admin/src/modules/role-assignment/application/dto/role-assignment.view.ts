import { type CursorPage } from '@kernel/core';

import { type RoleAssignment } from '../../domain/role-assignment.entity';

/**
 * A read-model view of a RoleAssignment returned by use-cases. Decouples the API
 * shape from the aggregate so internal refactors don't leak into the contract.
 */
export interface RoleAssignmentView {
  id: string;
  tenantId: string;
  userId: string;
  roleId: string;
  scope: string;
  status: string;
  validUntil: string | null;
  delegatedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Maps a RoleAssignment aggregate to its view representation. */
export function toRoleAssignmentView(assignment: RoleAssignment): RoleAssignmentView {
  return {
    id: assignment.id.toString(),
    tenantId: assignment.tenantId,
    userId: assignment.userId,
    roleId: assignment.roleId,
    scope: assignment.scope.toString(),
    status: assignment.status,
    validUntil: assignment.validUntil ? assignment.validUntil.toISOString() : null,
    delegatedBy: assignment.delegatedBy,
    version: assignment.version,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

/** A page of role-assignment views (mirrors the kernel CursorPage shape). */
export interface RoleAssignmentPageView {
  items: RoleAssignmentView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function toRoleAssignmentPageView(page: CursorPage<RoleAssignment>): RoleAssignmentPageView {
  return {
    items: page.items.map(toRoleAssignmentView),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}
