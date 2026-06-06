/**
 * Base class for all domain errors. Every subclass carries a stable string
 * `code` that the presentation layer maps to an HTTP status and to the
 * section-8.1 error envelope { error: { code, message, reason, ... } }.
 *
 * The kernel deliberately does NOT know about HTTP — the mapping lives in the
 * presentation layer's GlobalExceptionFilter.
 */
export abstract class DomainError extends Error {
  /** Stable, machine-readable code (snake_case). Part of the API contract. */
  public abstract readonly code: string;

  /** Optional: the specific rule/condition that failed (envelope `reason`). */
  public readonly reason?: string;

  protected constructor(message: string, reason?: string) {
    super(message);
    this.name = new.target.name;
    this.reason = reason;
    // Restore the prototype chain when targeting ES5/ES2015 down-leveling.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Requested aggregate/row does not exist (or is invisible under RLS). -> 404 */
export class NotFoundError extends DomainError {
  public readonly code = 'not_found';

  constructor(message = 'Resource not found', reason?: string) {
    super(message, reason);
  }
}

/** Invariant/uniqueness/optimistic-concurrency violation. -> 409 */
export class ConflictError extends DomainError {
  public readonly code = 'conflict';

  constructor(message = 'Conflict', reason?: string) {
    super(message, reason);
  }
}

/** Domain-level validation failure (distinct from transport-level 400). -> 400 */
export class ValidationError extends DomainError {
  public readonly code = 'validation_failed';

  constructor(message = 'Validation failed', reason?: string) {
    super(message, reason);
  }
}

/** Authorization denied by a domain rule or tenant guardrail. -> 403 */
export class ForbiddenError extends DomainError {
  public readonly code = 'forbidden';

  constructor(message = 'Forbidden', reason?: string) {
    super(message, reason);
  }
}
