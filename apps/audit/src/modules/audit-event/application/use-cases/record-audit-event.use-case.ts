import { Inject, Injectable } from '@nestjs/common';

import { type Clock, CLOCK } from '@kernel/core';

import { AuditEvent, GENESIS_HASH } from '../../domain/audit-event.entity';
import { DuplicateAuditEventError, InvalidAuditEventError } from '../../domain/audit-event.errors';
import {
  type AuditEventRepository,
  AUDIT_EVENT_REPOSITORY,
} from '../../domain/audit-event.repository.port';
import { parseAuditDecision } from '../../domain/value-objects/audit-decision.vo';
import { type RecordAuditEventCommand } from '../dto/audit-event.commands';
import { type AuditEventView, toAuditEventView } from '../dto/audit-event.view';

/**
 * Appends one event to the append-only, tamper-evident log (DESIGN §10 / App. C).
 *
 * Flow:
 *   1. validate + normalize the payload (decision enum, occurredAt),
 *   2. reject a duplicate id (idempotency — the chain holds one row per event),
 *   3. read the current chain head and build the hash-chained entity against it,
 *   4. `append`, which re-reads/locks the head and assigns the gap-free `seq`
 *      inside a transaction so concurrent appends stay serialized.
 *
 * Depends only on the repository PORT and the Clock port — no TypeORM, no HTTP.
 */
@Injectable()
export class RecordAuditEventUseCase {
  constructor(
    @Inject(AUDIT_EVENT_REPOSITORY) private readonly events: AuditEventRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: RecordAuditEventCommand): Promise<AuditEventView> {
    const decision = parseAuditDecision(command.decision);
    const occurredAt = this.parseOccurredAt(command.occurredAt);

    // Idempotency: a re-delivered event (same id) must not append a second row.
    if (command.id) {
      const existing = await this.events.findById(command.id);
      if (existing) {
        throw new DuplicateAuditEventError(command.id);
      }
    }

    const head = await this.events.chainHead();
    const prevHash = head?.recordHash ?? GENESIS_HASH;

    const event = AuditEvent.record({
      id: command.id,
      tenantId: command.tenantId,
      actor: command.actor,
      action: command.action,
      decision,
      resourceKind: command.resourceKind,
      resourceId: command.resourceId,
      reason: command.reason ?? null,
      policy: command.policy ?? null,
      decisionId: command.decisionId ?? null,
      traceId: command.traceId ?? null,
      occurredAt,
      recordedAt: this.clock.now(),
      prevHash,
    });

    const persisted = await this.events.append(event);
    return toAuditEventView(persisted);
  }

  /** Parses the source's `at` (ISO-8601), defaulting to now when absent/blank. */
  private parseOccurredAt(value: string | null | undefined): Date {
    if (value === null || value === undefined || value.trim().length === 0) {
      return this.clock.now();
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new InvalidAuditEventError('occurredAt must be an ISO-8601 timestamp', 'occurred_at_invalid');
    }
    return parsed;
  }
}
