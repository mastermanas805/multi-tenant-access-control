import { type CursorPage, Cursor, makeCursorPage } from '@kernel/core';

import { AuditEvent, type AuditEventSnapshot, GENESIS_HASH } from '../domain/audit-event.entity';
import { DuplicateAuditEventError } from '../domain/audit-event.errors';
import {
  type AuditEventListFilter,
  type AuditEventRepository,
  type ChainHead,
} from '../domain/audit-event.repository.port';

/**
 * In-memory AuditEventRepository so unit/e2e suites exercise the full
 * use-case/HTTP stack without Postgres. Mirrors the port contract exactly,
 * including the append behaviour: it re-links each record to the current head and
 * assigns a gap-free, increasing `seq` (the DB's BIGSERIAL analogue).
 */
export class InMemoryAuditEventRepository implements AuditEventRepository {
  private readonly rows: AuditEvent[] = [];
  private nextSeq = 1;

  public chainHead(): Promise<ChainHead | null> {
    const last = this.rows.at(-1);
    return Promise.resolve(last ? { seq: last.seq, recordHash: last.recordHash } : null);
  }

  public append(event: AuditEvent): Promise<AuditEvent> {
    if (this.rows.some((r) => r.id.toString() === event.id.toString())) {
      throw new DuplicateAuditEventError(event.id.toString());
    }
    const head = this.rows.at(-1);
    const prevHash = head?.recordHash ?? GENESIS_HASH;
    const recordHash = event.recomputeHash(prevHash);

    const snapshot: AuditEventSnapshot = {
      id: event.id.toString(),
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
      recordedAt: event.recordedAt,
      seq: this.nextSeq,
      prevHash,
      recordHash,
    };
    this.nextSeq += 1;
    const persisted = AuditEvent.fromSnapshot(snapshot);
    this.rows.push(persisted);
    return Promise.resolve(persisted);
  }

  public findById(id: string): Promise<AuditEvent | null> {
    return Promise.resolve(this.rows.find((r) => r.id.toString() === id) ?? null);
  }

  public list(filter: AuditEventListFilter): Promise<CursorPage<AuditEvent>> {
    let rows = [...this.rows].sort((a, b) => b.seq - a.seq);
    if (filter.tenantId) {
      rows = rows.filter((r) => r.tenantId === filter.tenantId);
    }
    if (filter.cursor) {
      const afterSeq = Number(Cursor.decode(filter.cursor));
      rows = rows.filter((r) => r.seq < afterSeq);
    }
    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const last = page.at(-1);
    const nextCursor = hasMore && last ? Cursor.encode(String(last.seq)) : null;
    return Promise.resolve(makeCursorPage(page, nextCursor));
  }

  public listAllInChainOrder(): Promise<AuditEvent[]> {
    return Promise.resolve([...this.rows].sort((a, b) => a.seq - b.seq));
  }

  // --- Test-only helpers (NOT part of the port) -----------------------------

  /** Replaces a stored record with a tampered copy (simulates DB tampering). */
  public tamperInPlace(seq: number, snapshot: AuditEventSnapshot): void {
    const index = this.rows.findIndex((r) => r.seq === seq);
    if (index >= 0) {
      this.rows[index] = AuditEvent.fromSnapshot(snapshot);
    }
  }

  /** Deletes a record by seq (simulates a row deletion that breaks the chain). */
  public deleteBySeq(seq: number): void {
    const index = this.rows.findIndex((r) => r.seq === seq);
    if (index >= 0) {
      this.rows.splice(index, 1);
    }
  }

  public all(): AuditEvent[] {
    return [...this.rows].sort((a, b) => a.seq - b.seq);
  }
}
