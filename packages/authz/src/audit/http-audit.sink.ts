import { Inject, Injectable, Logger } from '@nestjs/common';

import { type DecisionAuditRecord } from '@contracts/core';

import { AUTHZ_OPTIONS, type AuthzModuleOptions } from '../module/authz.options';
import { type AuditSink } from './audit-sink.port';

/**
 * HTTP Audit sink (DESIGN §8.7). Posts the decision record to the Audit service's
 * append-only, hash-chained ingest endpoint:
 *
 *   POST {auditUrl}/v1/audit/events
 *
 * The PEP carries the canonical `DecisionAuditRecord` (@contracts/core); this
 * adapter maps it onto the Audit service's `RecordAuditEventRequest` wire shape at
 * the HTTP boundary (`effect`->`decision`, `actorId`->`actor`, `decidedAt`->`at`).
 * Keeping the translation here lets the PEP stay agnostic of the Audit service's
 * DTO and lets the Audit service own a single ingest schema.
 *
 * Fire-and-forget: emitted AFTER the decision is enforced and intentionally NOT
 * awaited by the PEP, so audit latency/failure never affects the request (DESIGN
 * §4.3 step 7 — "Audit receives the decision (async)"). A failure is logged; in a
 * real deployment the durable buffer is Kafka (DESIGN §8.7), swappable behind this
 * port. The `traceId` links the record to logs and the §8.1 envelope.
 */
@Injectable()
export class HttpAuditSink implements AuditSink {
  private readonly logger = new Logger(HttpAuditSink.name);

  constructor(@Inject(AUTHZ_OPTIONS) private readonly options: AuthzModuleOptions) {}

  public record(record: DecisionAuditRecord): void {
    const url = new URL('/v1/audit/events', this.options.auditUrl);
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-trace-id': record.traceId },
      body: JSON.stringify(this.toIngestBody(record)),
    }).then(
      (res) => {
        if (!res.ok) {
          this.logger.warn(
            `Audit sink non-OK ${String(res.status)} for decision ${record.decisionId}`,
          );
        }
      },
      (err: unknown) => {
        this.logger.warn(`Audit sink error for decision ${record.decisionId}: ${String(err)}`);
      },
    );
  }

  /**
   * Adapts the canonical `DecisionAuditRecord` to the Audit service's
   * `RecordAuditEventRequest` field names (DESIGN §8.7). Optional fields are
   * omitted when empty so the audit DTO's `@IsOptional` validators pass.
   */
  private toIngestBody(record: DecisionAuditRecord): Record<string, unknown> {
    return {
      tenantId: record.tenantId,
      actor: record.actorId,
      action: record.action,
      decision: record.effect,
      resourceKind: record.resourceKind,
      resourceId: record.resourceId,
      decisionId: record.decisionId,
      traceId: record.traceId,
      at: record.decidedAt,
      ...(record.policy !== undefined ? { policy: record.policy } : {}),
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
    };
  }
}
