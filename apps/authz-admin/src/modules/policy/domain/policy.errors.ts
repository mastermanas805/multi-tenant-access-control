import { ConflictError, DomainError, NotFoundError } from '@kernel/core';

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

/**
 * The published `rule` jsonb could not be compiled into a Cerbos resource policy
 * (malformed body — missing resource/rules, bad effect, etc.). -> 422
 *
 * Extends DomainError directly so the GlobalExceptionFilter maps it to 422
 * UNPROCESSABLE_ENTITY with this stable code (the body is syntactically valid JSON
 * but semantically unprocessable as a policy). Fail-closed: a malformed rule never
 * reaches the PDP (DESIGN §9 D8).
 */
export class PolicyCompileError extends DomainError {
  public readonly code = 'policy_compile_failed';

  constructor(message: string) {
    super(message, 'policy_compile_failed');
  }
}
