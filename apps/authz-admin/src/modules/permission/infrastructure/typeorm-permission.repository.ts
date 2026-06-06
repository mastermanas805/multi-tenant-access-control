import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { type CursorPage, Cursor, type PageQuery, makeCursorPage } from '@kernel/core';

import { DATA_SOURCE } from '../../../shared/infrastructure/database/data-source';
import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { type Permission } from '../domain/permission.entity';
import { type PermissionRepository } from '../domain/permission.repository.port';
import { type PermissionId } from '../domain/value-objects/permission-id.vo';
import { PermissionMapper } from './permission.mapper';
import { PermissionOrmEntity } from './permission.orm-entity';

/**
 * TypeORM adapter implementing the PermissionRepository port.
 *
 * The permission catalog is GLOBAL (no `tenant_id`, no RLS policy), so reads are
 * not tenant-filtered. We still resolve the EntityManager through the tenant
 * context — exactly like every other repository — so statements run inside the
 * request-scoped transaction the RlsInterceptor opened; it falls back to the
 * DataSource manager outside a request (e.g. a background job).
 *
 * The cursor encodes the last row's `(createdAt,id)` so paging is stable.
 */
@Injectable()
export class TypeOrmPermissionRepository implements PermissionRepository {
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

  public async save(permission: Permission): Promise<void> {
    const orm = PermissionMapper.toOrm(permission);
    await this.manager.getRepository(PermissionOrmEntity).save(orm);
  }

  public async findById(id: PermissionId): Promise<Permission | null> {
    const row = await this.manager
      .getRepository(PermissionOrmEntity)
      .findOne({ where: { id: id.toString() } });
    return row ? PermissionMapper.toDomain(row) : null;
  }

  public async findByKey(key: string): Promise<Permission | null> {
    const row = await this.manager.getRepository(PermissionOrmEntity).findOne({ where: { key } });
    return row ? PermissionMapper.toDomain(row) : null;
  }

  public async list(query: PageQuery): Promise<CursorPage<Permission>> {
    const qb = this.manager
      .getRepository(PermissionOrmEntity)
      .createQueryBuilder('p')
      .orderBy('p.created_at', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .take(query.limit + 1); // fetch one extra to detect "hasMore"

    if (query.cursor) {
      const decoded = Cursor.decode(query.cursor);
      const [createdAt, id] = decoded.split('|');
      qb.where('(p.created_at, p.id) < (:createdAt, :id)', { createdAt, id });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const last = page.at(-1);
    const nextCursor =
      hasMore && last ? Cursor.encode(`${last.createdAt.toISOString()}|${last.id}`) : null;

    return makeCursorPage(
      page.map((row) => PermissionMapper.toDomain(row)),
      nextCursor,
    );
  }
}
