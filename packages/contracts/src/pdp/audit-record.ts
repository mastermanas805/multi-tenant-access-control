/**
 * The decision record a PEP emits to the Audit sink after every enforced check
 * (DESIGN §4.3 step 7, §8.7, FR-9). Posted to the Audit service; IDs-not-payloads,
 * tenant-scoped, linked by `traceId`, carrying the deciding rule + `decisionId`.
 *
 * Shared so every service's PEP emits the identical audit shape and the Audit
 * service can ingest one schema.
 */
export interface DecisionAuditRecord {
  readonly decisionId: string;
  readonly traceId: string;
  /** Tenant the decision was made in (DESIGN §6 — audit is tenant-scoped). */
  readonly tenantId: string;
  /** The principal evaluated (the end-user `sub`). */
  readonly principalId: string;
  /** The caller acting on the principal's behalf (the `actorId`; differs on S2S, DESIGN §7). */
  readonly actorId: string;
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly action: string;
  readonly effect: 'ALLOW' | 'DENY';
  /** The deciding policy id, e.g. `expense_report/acme.finance`. */
  readonly policy?: string;
  /** The deciding rule/condition in human terms. */
  readonly reason?: string;
  /** ISO-8601 timestamp the decision was made. */
  readonly decidedAt: string;
}
