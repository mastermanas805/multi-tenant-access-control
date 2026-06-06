import { ConflictError, NotFoundError } from '@kernel/core';

/** The requested role assignment does not exist (or is invisible under RLS). -> 404 */
export class RoleAssignmentNotFoundError extends NotFoundError {
  constructor(roleAssignmentId: string) {
    super(`Role assignment ${roleAssignmentId} not found`, 'role_assignment_not_found');
  }
}

/**
 * The same (user, role, scope) is already assigned within the tenant. -> 409
 * Inherits ConflictError's (message, reason?) constructor.
 */
export class RoleAssignmentAlreadyExistsError extends ConflictError {
  constructor(userId: string, roleId: string, scope: string) {
    super(
      `Role ${roleId} is already assigned to user ${userId} at scope ${scope}`,
      'role_assignment_exists',
    );
  }
}

/**
 * An operation is invalid for the assignment's current state (e.g. revoking an
 * already-revoked assignment). -> 409. Callers always pass a reason so the
 * envelope carries it.
 */
export class RoleAssignmentStateError extends ConflictError {}
