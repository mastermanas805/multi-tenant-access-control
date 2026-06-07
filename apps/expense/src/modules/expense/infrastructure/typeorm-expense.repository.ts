import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { type CursorPage, Cursor, type PageQuery, makeCursorPage } from '@kernel/core';

import { DATA_SOURCE } from '../../../shared/infrastructure/database/data-source';
import { guardOptimisticLock } from '../../../shared/infrastructure/database/optimistic-persist';
import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { type Expense } from '../domain/expense.entity';
import { type ExpenseRepository } from '../domain/expense.repository.port';
import { type ExpenseId } from '../domain/value-objects/expense-id.vo';
import { ExpenseMapper } from './expense.mapper';
import { ExpenseOrmEntity } from './expense.orm-entity';

/**
 * TypeORM adapter implementing the ExpenseRepository port.
 *
 * RLS: statements run inside a TENANT-SCOPED transaction so a query can ONLY ever
 * return the active tenant's rows (DESIGN §6 layer 1). There are two paths:
 *   - REQUEST path: the RlsInterceptor has already opened the request transaction
 *     and bound its QueryRunner (with `SET LOCAL app.current_tenant`); we reuse it.
 *   - GUARD path: the PEP's `loadResource` runs INSIDE the AuthzGuard, BEFORE the
 *     RlsInterceptor opens its transaction, so no runner is bound yet. The
 *     IdentityTenantContextGuard has bound the tenant id, so we open a short
 *     tenant-scoped transaction for that read. (Outside RLS, the policy predicate
 *     `current_setting('app.current_tenant', true)` is NULL and returns ZERO
 *     rows, which would make loadResource always 404 — so we never fall through
 *     to an unscoped manager when a tenant is bound and the DB is enabled.)
 *
 * The cursor encodes the last row's `(createdAt,id)` so paging is stable.
 */
@Injectable()
export class TypeOrmExpenseRepository implements ExpenseRepository {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  public async save(expense: Expense): Promise<void> {
    await this.withTenantManager(async (manager) => {
      const orm = ExpenseMapper.toOrm(expense);
      // Atomic optimistic-concurrency CAS before the full write (DESIGN §8.1).
      await guardOptimisticLock(manager, ExpenseOrmEntity, orm.id, orm.version);
      await manager.getRepository(ExpenseOrmEntity).save(orm);
    });
  }

  public async findById(id: ExpenseId): Promise<Expense | null> {
    return this.withTenantManager(async (manager) => {
      const row = await manager
        .getRepository(ExpenseOrmEntity)
        .findOne({ where: { id: id.toString() } });
      return row ? ExpenseMapper.toDomain(row) : null;
    });
  }

  public async list(query: PageQuery): Promise<CursorPage<Expense>> {
    return this.withTenantManager(async (manager) => {
      const qb = manager
        .getRepository(ExpenseOrmEntity)
        .createQueryBuilder('e')
        .orderBy('e.created_at', 'DESC')
        .addOrderBy('e.id', 'DESC')
        .take(query.limit + 1); // fetch one extra to detect "hasMore"

      if (query.cursor) {
        const decoded = Cursor.decode(query.cursor);
        const [createdAt, id] = decoded.split('|');
        qb.where('(e.created_at, e.id) < (:createdAt, :id)', { createdAt, id });
      }

      const rows = await qb.getMany();
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;

      const last = page.at(-1);
      const nextCursor =
        hasMore && last ? Cursor.encode(`${last.createdAt.toISOString()}|${last.id}`) : null;

      return makeCursorPage(
        page.map((row) => ExpenseMapper.toDomain(row)),
        nextCursor,
      );
    });
  }

  /**
   * Runs `fn` against a TENANT-SCOPED EntityManager. Reuses the request-scoped
   * runner bound by the RlsInterceptor when present; otherwise (the in-guard
   * loadResource path) opens a short transaction with `app.current_tenant` set so
   * RLS applies, committing/rolling back around the callback.
   */
  private async withTenantManager<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    const store = this.tenantContext.getStore();
    if (store?.queryRunner) {
      return fn(store.queryRunner.manager);
    }

    // No request transaction yet. If a tenant is bound, open a scoped one so RLS
    // is enforced for this read (never an unscoped manager — see class doc).
    const tenantId = store?.tenantId;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      if (tenantId) {
        await queryRunner.query('SELECT set_config($1, $2, true)', [
          'app.current_tenant',
          tenantId,
        ]);
      }
      const result = await fn(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
