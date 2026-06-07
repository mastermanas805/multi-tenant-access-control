import { type DecisionAuditRecord } from '@contracts/core';

/**
 * Application-layer command/query inputs. Plain data shapes (no framework
 * decorators) handed from the controller to the use-cases. HTTP-facing validation
 * lives on the presentation request DTOs.
 */

export interface RecordAuditEventCommand {
  /** Optional client-supplied id used as the idempotency key (DESIGN §8.1). */
  id?: string;
  tenantId: string;
  actor: string;
  action: string;
  /** ALLOW | DENY | N/A (case-insensitive). */
  decision: string;
  resourceKind: string;
  resourceId: string;
  reason?: string | null;
  policy?: string | null;
  decisionId?: string | null;
  traceId?: string | null;
  /** ISO-8601 instant the decision/change occurred (the source's `at`). */
  occurredAt?: string | null;
}

export interface ListAuditEventsQuery {
  tenantId?: string;
  limit?: number;
  cursor?: string | null;
}

/**
 * Adapts the SHARED `DecisionAuditRecord` (@contracts/core) — the exact shape a
 * service's PEP emits to its AuditSink (DESIGN §8.7, FR-9) — into the ingest
 * command. This is the canonical mapping for the common case (a PEP posting a
 * decision); the HTTP DTO additionally accepts admin/PAP-change events
 * (`decision: 'N/A'`). Field mapping: `effect`->`decision`, `actorId`->`actor`,
 * `decidedAt`->`occurredAt`. Kept pure so it is reusable and testable.
 */
export function commandFromDecisionRecord(record: DecisionAuditRecord): RecordAuditEventCommand {
  return {
    tenantId: record.tenantId,
    actor: record.actorId,
    action: record.action,
    decision: record.effect,
    resourceKind: record.resourceKind,
    resourceId: record.resourceId,
    reason: record.reason ?? null,
    policy: record.policy ?? null,
    decisionId: record.decisionId,
    traceId: record.traceId,
    occurredAt: record.decidedAt,
  };
}
