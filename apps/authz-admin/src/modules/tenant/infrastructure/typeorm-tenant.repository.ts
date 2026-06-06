import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { type CursorPage, Cursor, type PageQuery, makeCursorPage } from '@kernel/core';

import { DATA_SOURCE } from '../../../shared/infrastructure/database/data-source';
import { guardOptimisticLock } from '../../../shared/infrastructure/database/optimistic-persist';
import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { type Tenant } from '../domain/tenant.entity';
import { type TenantRepository } from '../domain/tenant.repository.port';
import { type TenantId } from '../domain/value-objects/tenant-id.vo';
import { TenantMapper } from './tenant.mapper';
import { TenantOrmEntity } from './tenant.orm-entity';

/**
 * TypeORM adapter implementing the TenantRepository port.
 *
 * RLS: it executes through the request-scoped EntityManager bound by the
 * RlsInterceptor (which ran `SET LOCAL app.current_tenant`), so every statement
 * is inside the tenant-scoped transaction. When no request-scoped runner exists
 * (e.g. a background job), it falls back to the DataSource manager.
 *
 * The cursor encodes the last row's `(createdAt,id)` so paging is stable.
 */
@Injectable()
export class TypeOrmTenantRepository implements TenantRepository {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Always resolve the manager through the tenant context so RLS applies. */
  private get manager(): EntityManager {
    const store = this.tenantContext.getStore();
    if (store?.queryRunner) {
      return store.queryRunner.manager;
    }
    return this.dataSource.manager;
  }

  public async save(tenant: Tenant): Promise<void> {
    const orm = TenantMapper.toOrm(tenant);
    // Atomic optimistic-concurrency CAS before the full write (DESIGN §8.1).
    await guardOptimisticLock(this.manager, TenantOrmEntity, orm.id, orm.version);
    await this.manager.getRepository(TenantOrmEntity).save(orm);
  }

  public async findById(id: TenantId): Promise<Tenant | null> {
    const row = await this.manager
      .getRepository(TenantOrmEntity)
      .findOne({ where: { id: id.toString() } });
    return row ? TenantMapper.toDomain(row) : null;
  }

  public async findBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.manager.getRepository(TenantOrmEntity).findOne({ where: { slug } });
    return row ? TenantMapper.toDomain(row) : null;
  }

  public async list(query: PageQuery): Promise<CursorPage<Tenant>> {
    const qb = this.manager
      .getRepository(TenantOrmEntity)
      .createQueryBuilder('t')
      .orderBy('t.created_at', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .take(query.limit + 1); // fetch one extra to detect "hasMore"

    if (query.cursor) {
      const decoded = Cursor.decode(query.cursor);
      const [createdAt, id] = decoded.split('|');
      qb.where('(t.created_at, t.id) < (:createdAt, :id)', { createdAt, id });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const last = page.at(-1);
    const nextCursor =
      hasMore && last ? Cursor.encode(`${last.createdAt.toISOString()}|${last.id}`) : null;

    return makeCursorPage(
      page.map((row) => TenantMapper.toDomain(row)),
      nextCursor,
    );
  }
}
