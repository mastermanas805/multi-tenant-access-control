import { ConflictError, ValidationError } from '@kernel/core';

/**
 * The submitted event failed a domain invariant (e.g. empty actor, bad decision).
 * Distinct from transport validation; surfaced as 400 via the §8.1 envelope.
 */
export class InvalidAuditEventError extends ValidationError {}

/**
 * An event with the same `id` (idempotency key) was already recorded. The append
 * is rejected rather than duplicated so the chain stays one-entry-per-event. -> 409
 */
export class DuplicateAuditEventError extends ConflictError {
  constructor(id: string) {
    super(`Audit event ${id} was already recorded`, 'audit_event_duplicate');
  }
}
