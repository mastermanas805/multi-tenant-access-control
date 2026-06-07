import { type CursorPage, type PageQuery } from '@kernel/core';

import { type AuditEvent } from './audit-event.entity';

/** Filters for listing audit events (the explainer/decision-log UI). */
export interface AuditEventListFilter extends PageQuery {
  /** Restrict to a single tenant's events (the common case). */
  readonly tenantId?: string;
}

/** The current chain head: the last appended record's hash + its seq. */
export interface ChainHead {
  readonly seq: number;
  readonly recordHash: string;
}

/**
 * Repository PORT for the append-only audit log. The domain/application layers
 * depend ONLY on this interface; the TypeORM adapter implements it.
 *
 * `append` is the single mutating operation — it MUST atomically read the current
 * chain head and insert the new record linked to it (the entity has already been
 * built against a head via `chainHead()`, but the adapter performs the append
 * inside a transaction with the head re-read + locked to keep the chain
 * gap-free and serialized under concurrency). There is intentionally no update or
 * delete: the log is immutable (DESIGN §10 / App. C).
 */
export interface AuditEventRepository {
  /** Reads the current chain head (or null when the log is empty / genesis). */
  chainHead(): Promise<ChainHead | null>;

  /**
   * Appends a record to the chain. Implementations serialize concurrent appends
   * so `seq` is gap-free and each `prevHash` matches the prior `recordHash`.
   * Returns the persisted event (with its assigned `seq`).
   */
  append(event: AuditEvent): Promise<AuditEvent>;

  /** Loads an event by its id, or null. Used for idempotency on append. */
  findById(id: string): Promise<AuditEvent | null>;

  /** Cursor-paginated list (newest first), optionally filtered by tenant. */
  list(filter: AuditEventListFilter): Promise<CursorPage<AuditEvent>>;

  /**
   * Streams ALL records in chain order (ascending `seq`) for integrity
   * verification. Optionally tenant-scoped is NOT offered: the chain spans all
   * tenants, so verification must replay the full chain.
   */
  listAllInChainOrder(): Promise<AuditEvent[]>;
}

/**
 * DI token for the repository port. Use-cases inject this token (not the class)
 * so they remain framework- and persistence-agnostic.
 */
export const AUDIT_EVENT_REPOSITORY = Symbol('AUDIT_EVENT_REPOSITORY');
