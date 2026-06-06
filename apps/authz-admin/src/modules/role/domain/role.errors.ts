import { ConflictError, NotFoundError } from '@kernel/core';

/** The requested role does not exist (or is invisible under RLS). -> 404 */
export class RoleNotFoundError extends NotFoundError {
  constructor(roleId: string) {
    super(`Role ${roleId} not found`, 'role_not_found');
  }
}

/** A role with the same key already exists for this tenant. -> 409 */
export class RoleKeyTakenError extends ConflictError {
  constructor(key: string) {
    super(`Role key "${key}" is already taken for this tenant`, 'role_key_taken');
  }
}

/**
 * An operation is invalid for the role's current permission set. -> 409
 * Inherits ConflictError's (message, reason?) constructor; callers always pass a
 * reason (e.g. "role_permission_already_granted") so the envelope carries it.
 */
export class RolePermissionError extends ConflictError {}
