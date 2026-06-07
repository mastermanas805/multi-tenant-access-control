import { AuditEvent } from '../domain/audit-event.entity';
import { AuditEventOrmEntity } from './audit-event.orm-entity';

/**
 * Translates between the AuditEvent entity and its TypeORM row. The only place
 * that knows both shapes, keeping the domain free of persistence concerns.
 *
 * `seq` is a BIGSERIAL stored as a string by the pg driver (bigint > 2^53). The
 * domain models it as a number for the read-model/view; values are well within
 * the safe-integer range for any realistic log size, and the conversion is
 * isolated here.
 */
export const AuditEventMapper = {
  /** Entity -> ORM row (for INSERT). `seq` is omitted so the DB assigns it. */
  toOrm(event: AuditEvent): AuditEventOrmEntity {
    const orm = new AuditEventOrmEntity();
    orm.id = event.id.toString();
    orm.tenantId = event.tenantId;
    orm.actor = event.actor;
    orm.action = event.action;
    orm.decision = event.decision;
    orm.resourceKind = event.resourceKind;
    orm.resourceId = event.resourceId;
    orm.reason = event.reason;
    orm.policy = event.policy;
    orm.decisionId = event.decisionId;
    orm.traceId = event.traceId;
    orm.occurredAt = event.occurredAt;
    orm.recordedAt = event.recordedAt;
    orm.prevHash = event.prevHash;
    orm.recordHash = event.recordHash;
    return orm;
  },

  /** ORM row -> entity (rehydration via the entity's snapshot factory). */
  toDomain(orm: AuditEventOrmEntity): AuditEvent {
    return AuditEvent.fromSnapshot({
      id: orm.id,
      tenantId: orm.tenantId,
      actor: orm.actor,
      action: orm.action,
      decision: orm.decision,
      resourceKind: orm.resourceKind,
      resourceId: orm.resourceId,
      reason: orm.reason,
      policy: orm.policy,
      decisionId: orm.decisionId,
      traceId: orm.traceId,
      occurredAt: orm.occurredAt,
      recordedAt: orm.recordedAt,
      seq: Number(orm.seq),
      prevHash: orm.prevHash,
      recordHash: orm.recordHash,
    });
  },
} as const;
