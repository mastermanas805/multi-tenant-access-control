import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, QueryFailedError } from 'typeorm';

import { type CursorPage, Cursor, makeCursorPage } from '@kernel/core';

import { DATA_SOURCE } from '../../../shared/infrastructure/database/data-source';
import { AuditEvent, GENESIS_HASH } from '../domain/audit-event.entity';
import { DuplicateAuditEventError } from '../domain/audit-event.errors';
import {
  type AuditEventListFilter,
  type AuditEventRepository,
  type ChainHead,
} from '../domain/audit-event.repository.port';
import { AuditEventMapper } from './audit-event.mapper';
import { AuditEventOrmEntity } from './audit-event.orm-entity';

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * TypeORM adapter implementing the append-only AuditEventRepository port.
 *
 * APPEND CONCURRENCY (the load-bearing part): the hash chain requires that each
 * record's `prevHash` equals the immediately-preceding record's `recordHash` and
 * that `seq` is gap-free. Two concurrent appends must NOT both link to the same
 * head. The append therefore runs in a SERIALIZABLE transaction that:
 *   1. re-reads the current head INSIDE the tx,
 *   2. recomputes the record's hash against that fresh head (so a stale head read
 *      by the use-case cannot corrupt the link),
 *   3. inserts the row (the DB assigns the BIGSERIAL `seq`).
 * Under contention Postgres aborts the loser with a serialization failure
 * (40001); we retry a bounded number of times. The unique index on `record_hash`
 * is a final backstop against a duplicated link.
 *
 * The cursor encodes the last row's `seq` so paging is stable and total-ordered.
 */
@Injectable()
export class TypeOrmAuditEventRepository implements AuditEventRepository {
  private static readonly MAX_APPEND_RETRIES = 5;

  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  public async chainHead(): Promise<ChainHead | null> {
    return this.readHead(this.dataSource.manager);
  }

  public async append(event: AuditEvent): Promise<AuditEvent> {
    let lastError: unknown;
    for (let attempt = 0; attempt < TypeOrmAuditEventRepository.MAX_APPEND_RETRIES; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          // Re-read the head inside the tx and re-link the record to it, so a
          // stale head from the use-case cannot break the chain.
          const head = await this.readHead(manager);
          const prevHash = head?.recordHash ?? GENESIS_HASH;
          const recordHash = event.recomputeHash(prevHash);

          const orm = AuditEventMapper.toOrm(event);
          orm.prevHash = prevHash;
          orm.recordHash = recordHash;

          const inserted = await manager.getRepository(AuditEventOrmEntity).insert(orm);
          // The DB-assigned bigserial comes back in the insert identifiers.
          const assignedSeq = inserted.identifiers[0]?.seq as string | number | undefined;
          orm.seq = assignedSeq !== undefined ? String(assignedSeq) : orm.seq;

          return AuditEventMapper.toDomain(orm);
        });
      } catch (err) {
        if (this.isDuplicateId(err)) {
          throw new DuplicateAuditEventError(event.id.toString());
        }
        if (this.isSerializationFailure(err)) {
          lastError = err;
          continue; // retry the append against the new head
        }
        throw err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Audit append failed after serialization retries');
  }

  public async findById(id: string): Promise<AuditEvent | null> {
    const row = await this.dataSource.manager
      .getRepository(AuditEventOrmEntity)
      .findOne({ where: { id } });
    return row ? AuditEventMapper.toDomain(row) : null;
  }

  public async list(filter: AuditEventListFilter): Promise<CursorPage<AuditEvent>> {
    const qb = this.dataSource.manager
      .getRepository(AuditEventOrmEntity)
      .createQueryBuilder('e')
      .orderBy('e.seq', 'DESC')
      .take(filter.limit + 1); // fetch one extra to detect "hasMore"

    if (filter.tenantId) {
      qb.andWhere('e.tenant_id = :tenantId', { tenantId: filter.tenantId });
    }

    if (filter.cursor) {
      const decoded = Cursor.decode(filter.cursor);
      qb.andWhere('e.seq < :seq', { seq: decoded });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;

    const last = page.at(-1);
    const nextCursor = hasMore && last ? Cursor.encode(last.seq) : null;

    return makeCursorPage(
      page.map((row) => AuditEventMapper.toDomain(row)),
      nextCursor,
    );
  }

  public async listAllInChainOrder(): Promise<AuditEvent[]> {
    const rows = await this.dataSource.manager
      .getRepository(AuditEventOrmEntity)
      .createQueryBuilder('e')
      .orderBy('e.seq', 'ASC')
      .getMany();
    return rows.map((row) => AuditEventMapper.toDomain(row));
  }

  /** Reads the highest-seq row's hash via the given manager (tx-aware). */
  private async readHead(manager: EntityManager): Promise<ChainHead | null> {
    const row = await manager
      .getRepository(AuditEventOrmEntity)
      .createQueryBuilder('e')
      .orderBy('e.seq', 'DESC')
      .limit(1)
      .getOne();
    return row ? { seq: Number(row.seq), recordHash: row.recordHash } : null;
  }

  private isDuplicateId(err: unknown): boolean {
    const failure = this.asQueryFailure(err);
    if (!failure) {
      return false;
    }
    // Distinguish the id collision from a record_hash collision.
    return failure.code === PG_UNIQUE_VIOLATION && failure.message.includes('uq_audit_events_id');
  }

  private isSerializationFailure(err: unknown): boolean {
    const failure = this.asQueryFailure(err);
    if (!failure) {
      return false;
    }
    // 40001 serialization_failure, 40P01 deadlock_detected, or a record_hash
    // unique collision from a racing append linking to the same head.
    return (
      failure.code === '40001' ||
      failure.code === '40P01' ||
      (failure.code === PG_UNIQUE_VIOLATION &&
        failure.message.includes('uq_audit_events_record_hash'))
    );
  }

  /** Extracts the Postgres SQLSTATE code + message from a TypeORM query failure. */
  private asQueryFailure(err: unknown): { code: string | undefined; message: string } | null {
    if (!(err instanceof QueryFailedError)) {
      return null;
    }
    const driverError = err.driverError as { code?: string } | undefined;
    return { code: driverError?.code, message: err.message };
  }
}
