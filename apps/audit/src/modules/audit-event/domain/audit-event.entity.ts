import { Entity, Guard, UniqueEntityID } from '@kernel/core';

import { type CanonicalAuditEvent, computeRecordHash } from './hash-chain';
import { type AuditDecision } from './value-objects/audit-decision.vo';

/** Internal property bag for the AuditEvent entity. */
export interface AuditEventProps {
  tenantId: string;
  actor: string;
  action: string;
  decision: AuditDecision;
  resourceKind: string;
  resourceId: string;
  reason: string | null;
  policy: string | null;
  decisionId: string | null;
  traceId: string | null;
  occurredAt: Date;
  /** When this service recorded the event (chain-append time). */
  recordedAt: Date;
  /** Chain position assigned by persistence; -1 until appended. */
  seq: number;
  /** Previous record's hash (or GENESIS_HASH for the first record). */
  prevHash: string;
  /** sha256(prevHash || canonical(event)). */
  recordHash: string;
}

/** Caller-supplied content for a new audit event (the request payload). */
export interface RecordAuditEventProps {
  id?: string;
  tenantId: string;
  actor: string;
  action: string;
  decision: AuditDecision;
  resourceKind: string;
  resourceId: string;
  reason?: string | null;
  policy?: string | null;
  decisionId?: string | null;
  traceId?: string | null;
  occurredAt: Date;
  /** The instant the chain append happens (from the CLOCK port). */
  recordedAt: Date;
  /** The current chain head hash to link this record to (GENESIS_HASH if empty). */
  prevHash: string;
}

/** Snapshot used to rehydrate a recorded event from persistence (mapper builds it). */
export interface AuditEventSnapshot {
  id: string;
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
  occurredAt: Date;
  recordedAt: Date;
  seq: number;
  prevHash: string;
  recordHash: string;
}

/**
 * AuditEvent — one immutable row in the append-only, tamper-evident log
 * (DESIGN §10 / App. C). It is an Entity, not an AggregateRoot: there are no
 * post-write domain events to dispatch (the log is a terminal sink), and it must
 * never be mutated after creation.
 *
 * On `record(...)` the entity validates its content and computes its own
 * `recordHash = sha256(prevHash || canonical(event))`, binding it into the chain.
 * The `seq` is assigned by persistence on append (the DB sequence is the single
 * source of total order).
 */
export class AuditEvent extends Entity<AuditEventProps> {
  private constructor(props: AuditEventProps, id: UniqueEntityID) {
    super(props, id);
  }

  // --- Factory (new record) --------------------------------------------------

  /**
   * Builds a new, hash-chained audit event from caller content. Validates the
   * required fields and computes the record hash against the supplied chain head.
   */
  public static record(props: RecordAuditEventProps): AuditEvent {
    Guard.againstEmpty(props.tenantId, 'tenantId');
    Guard.invariant(
      UniqueEntityID.isValidUuid(props.tenantId),
      'tenantId must be a UUID',
      'tenant_id_invalid',
    );
    Guard.againstEmpty(props.actor, 'actor');
    Guard.againstEmpty(props.action, 'action');
    Guard.againstEmpty(props.resourceKind, 'resourceKind');
    Guard.againstEmpty(props.resourceId, 'resourceId');
    Guard.againstEmpty(props.prevHash, 'prevHash');

    const id = props.id ?? new UniqueEntityID().toString();
    Guard.invariant(UniqueEntityID.isValidUuid(id), 'id must be a UUID', 'audit_event_id_invalid');

    const reason = normalizeOptional(props.reason);
    const policy = normalizeOptional(props.policy);
    const decisionId = normalizeOptional(props.decisionId);
    const traceId = normalizeOptional(props.traceId);

    const canonical: CanonicalAuditEvent = {
      id,
      tenantId: props.tenantId,
      actor: props.actor,
      action: props.action,
      decision: props.decision,
      resourceKind: props.resourceKind,
      resourceId: props.resourceId,
      reason,
      policy,
      decisionId,
      traceId,
      occurredAt: props.occurredAt.toISOString(),
    };
    const recordHash = computeRecordHash(props.prevHash, canonical);

    return new AuditEvent(
      {
        tenantId: props.tenantId,
        actor: props.actor,
        action: props.action,
        decision: props.decision,
        resourceKind: props.resourceKind,
        resourceId: props.resourceId,
        reason,
        policy,
        decisionId,
        traceId,
        occurredAt: props.occurredAt,
        recordedAt: props.recordedAt,
        seq: -1,
        prevHash: props.prevHash,
        recordHash,
      },
      new UniqueEntityID(id),
    );
  }

  // --- Rehydration (from persistence) ----------------------------------------

  public static fromSnapshot(snapshot: AuditEventSnapshot): AuditEvent {
    return new AuditEvent(
      {
        tenantId: snapshot.tenantId,
        actor: snapshot.actor,
        action: snapshot.action,
        decision: snapshot.decision as AuditDecision,
        resourceKind: snapshot.resourceKind,
        resourceId: snapshot.resourceId,
        reason: snapshot.reason,
        policy: snapshot.policy,
        decisionId: snapshot.decisionId,
        traceId: snapshot.traceId,
        occurredAt: snapshot.occurredAt,
        recordedAt: snapshot.recordedAt,
        seq: snapshot.seq,
        prevHash: snapshot.prevHash,
        recordHash: snapshot.recordHash,
      },
      new UniqueEntityID(snapshot.id),
    );
  }

  // --- Getters ---------------------------------------------------------------

  public get tenantId(): string {
    return this.props.tenantId;
  }

  public get actor(): string {
    return this.props.actor;
  }

  public get action(): string {
    return this.props.action;
  }

  public get decision(): AuditDecision {
    return this.props.decision;
  }

  public get resourceKind(): string {
    return this.props.resourceKind;
  }

  public get resourceId(): string {
    return this.props.resourceId;
  }

  public get reason(): string | null {
    return this.props.reason;
  }

  public get policy(): string | null {
    return this.props.policy;
  }

  public get decisionId(): string | null {
    return this.props.decisionId;
  }

  public get traceId(): string | null {
    return this.props.traceId;
  }

  public get occurredAt(): Date {
    return this.props.occurredAt;
  }

  public get recordedAt(): Date {
    return this.props.recordedAt;
  }

  public get seq(): number {
    return this.props.seq;
  }

  public get prevHash(): string {
    return this.props.prevHash;
  }

  public get recordHash(): string {
    return this.props.recordHash;
  }

  /** The deterministic, signed content of this event (used to re-verify the hash). */
  public toCanonical(): CanonicalAuditEvent {
    return {
      id: this.id.toString(),
      tenantId: this.props.tenantId,
      actor: this.props.actor,
      action: this.props.action,
      decision: this.props.decision,
      resourceKind: this.props.resourceKind,
      resourceId: this.props.resourceId,
      reason: this.props.reason,
      policy: this.props.policy,
      decisionId: this.props.decisionId,
      traceId: this.props.traceId,
      occurredAt: this.props.occurredAt.toISOString(),
    };
  }

  /** Recomputes this record's hash against a given previous hash. */
  public recomputeHash(prevHash: string): string {
    return computeRecordHash(prevHash, this.toCanonical());
  }
}

/** The genesis previous-hash, re-exported so callers don't import the chain module. */
export { GENESIS_HASH } from './hash-chain';

/** Trims a value to null when empty/absent so optionals canonicalize consistently. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
