import { Guard } from '@kernel/core';

/**
 * The decision outcome recorded for an event. Mirrors the §8.2 PDP effect plus
 * an `N/A` for admin/PAP change events that are not allow/deny decisions but are
 * still part of the immutable change log (DESIGN §10 — "all admin/PAP changes").
 */
export enum AuditDecision {
  Allow = 'ALLOW',
  Deny = 'DENY',
  NotApplicable = 'N/A',
}

const VALID = Object.values(AuditDecision);

/** Parses/validates a raw decision string into the enum (fail-closed). */
export function parseAuditDecision(value: string): AuditDecision {
  const upper = value.toUpperCase();
  Guard.oneOf(upper as AuditDecision, VALID, 'decision');
  return upper as AuditDecision;
}
