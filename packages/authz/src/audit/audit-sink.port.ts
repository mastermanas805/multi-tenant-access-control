import { type DecisionAuditRecord } from '@contracts/core';

/**
 * The Audit sink port (DESIGN §4.3 step 7, §8.7, FR-9). The PEP emits a decision
 * record AFTER enforcing — asynchronously and best-effort, so auditing never
 * blocks or fails the request hot path (a real deployment buffers via Kafka,
 * DESIGN §8.7). Implementations post to the Audit service.
 */
export interface AuditSink {
  /** Record an enforced decision. Must not throw into the request path (fire-and-forget). */
  record(record: DecisionAuditRecord): void;
}

/** DI token for the AuditSink port. */
export const AUDIT_SINK = Symbol('AUDIT_SINK');
