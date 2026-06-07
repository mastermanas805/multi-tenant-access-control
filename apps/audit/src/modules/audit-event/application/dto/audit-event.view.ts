import { type CursorPage } from '@kernel/core';

import { type AuditEvent } from '../../domain/audit-event.entity';

/**
 * A read-model view of a recorded audit event returned by use-cases. Includes the
 * chain fields (`seq`, `prevHash`, `recordHash`) so the explainer UI can show and
 * independently re-verify the tamper-evident chain.
 */
export interface AuditEventView {
  id: string;
  seq: number;
  tenantId: string;
  actor: string;
  action: string;
  decision: string;
  resourceKind: string;
  resourceId: string;
  reason: string | null;
  policy: string | null;
  decisionId: string | null;
  traceId: string | null;
  occurredAt: string;
  recordedAt: string;
  prevHash: string;
  recordHash: string;
}

/** Maps an AuditEvent entity to its view representation. */
export function toAuditEventView(event: AuditEvent): AuditEventView {
  return {
    id: event.id.toString(),
    seq: event.seq,
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
    occurredAt: event.occurredAt.toISOString(),
    recordedAt: event.recordedAt.toISOString(),
    prevHash: event.prevHash,
    recordHash: event.recordHash,
  };
}

/** A page of audit-event views (mirrors the kernel CursorPage shape). */
export interface AuditEventPageView {
  items: AuditEventView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function toAuditEventPageView(page: CursorPage<AuditEvent>): AuditEventPageView {
  return {
    items: page.items.map(toAuditEventView),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

/** Result of replaying the chain to check for tampering. */
export interface ChainVerificationView {
  /** True when every record's hash and link is intact from genesis to head. */
  valid: boolean;
  /** Number of records replayed. */
  count: number;
  /** The chain head hash (or the genesis hash when the log is empty). */
  headHash: string;
  /** The first broken record's seq + why, when invalid; null when valid. */
  brokenAt: { seq: number; reason: string } | null;
}
