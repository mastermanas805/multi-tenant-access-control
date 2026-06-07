import { createHash } from 'node:crypto';

/**
 * Tamper-evident hash chain over the immutable audit log (DESIGN §10 / App. C).
 *
 * This is PURE domain logic — no framework, no persistence — so the chain
 * algorithm is the single, testable source of truth shared by the aggregate and
 * the integrity verifier.
 *
 * Each record's hash is `sha256( prev_hash || canonical(event) )`, where:
 *   - `prev_hash` is the previous record's hash (hex), and the chain starts from
 *     a fixed GENESIS_HASH so even the first record is anchored.
 *   - `canonical(event)` is a deterministic serialization of the event's
 *     security-relevant fields (see {@link canonicalizeEvent}). Determinism is
 *     load-bearing: if serialization varied, re-verification would diverge from
 *     the original and produce false tamper alarms.
 *
 * Tampering with, deleting, or reordering any historical record changes its hash,
 * which breaks `prev_hash` for every record after it — detectable by replaying
 * the chain from genesis.
 */

/** The chain anchor: 64 hex zeros. The first (genesis) record links to this. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * The fields covered by the hash. Ordering is FIXED (the canonical form below
 * pins it explicitly), so this type documents exactly what tampering is detected.
 * Anything not in this shape (e.g. the surrogate `seq`/`recordedAt`) is NOT part
 * of the signed content.
 */
export interface CanonicalAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly action: string;
  readonly decision: string;
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly reason: string | null;
  readonly policy: string | null;
  readonly decisionId: string | null;
  readonly traceId: string | null;
  /** ISO-8601 instant the decision/change occurred. */
  readonly occurredAt: string;
}

/**
 * Deterministic serialization of an event's signed content. We build the object
 * with keys in a FIXED order and JSON.stringify it (string values only, so no
 * locale/number ambiguity). `null` is used for absent optional fields so the
 * presence/absence of a field cannot be forged into the same bytes.
 */
export function canonicalizeEvent(event: CanonicalAuditEvent): string {
  // Explicit, ordered tuple — do NOT spread the input (key order would follow
  // the caller's object, not this canonical contract).
  const ordered: CanonicalAuditEvent = {
    id: event.id,
    tenantId: event.tenantId,
    actor: event.actor,
    action: event.action,
    decision: event.decision,
    resourceKind: event.resourceKind,
    resourceId: event.resourceId,
    reason: event.reason,
    policy: event.policy,
    decisionId: event.decisionId,
    traceId: event.traceId,
    occurredAt: event.occurredAt,
  };
  return JSON.stringify(ordered);
}

/** Computes the chain hash for an event given the previous record's hash. */
export function computeRecordHash(prevHash: string, event: CanonicalAuditEvent): string {
  return createHash('sha256')
    .update(prevHash, 'utf8')
    .update('\n', 'utf8')
    .update(canonicalizeEvent(event), 'utf8')
    .digest('hex');
}
