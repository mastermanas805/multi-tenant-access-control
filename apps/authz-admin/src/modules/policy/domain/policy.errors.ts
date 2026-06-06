import { ConflictError, NotFoundError } from '@kernel/core';

/** The requested policy does not exist (or is invisible under RLS). -> 404 */
export class PolicyNotFoundError extends NotFoundError {
  constructor(policyId: string) {
    super(`Policy ${policyId} not found`, 'policy_not_found');
  }
}

/**
 * An operation is invalid for the policy's current status. -> 409
 * Inherits ConflictError's (message, reason?) constructor; callers always pass a
 * reason (e.g. "policy_already_active") so the envelope carries it.
 */
export class PolicyStatusError extends ConflictError {}

/**
 * A rollback referenced a version that does not exist for the policy scope. -> 409
 */
export class PolicyVersionNotFoundError extends ConflictError {
  constructor(scope: string, version: number) {
    super(
      `Policy version ${String(version)} not found for scope "${scope}"`,
      'policy_version_not_found',
    );
  }
}
