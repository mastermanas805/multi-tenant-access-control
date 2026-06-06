import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { type CursorPage, Cursor, type PageQuery, makeCursorPage } from '@kernel/core';

import { DATA_SOURCE } from '../../../shared/infrastructure/database/data-source';
import { guardOptimisticLock } from '../../../shared/infrastructure/database/optimistic-persist';
import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { type Role } from '../domain/role.entity';
import { type RoleRepository } from '../domain/role.repository.port';
import { type RoleId } from '../domain/value-objects/role-id.vo';
import { RoleMapper } from './role.mapper';
import { RoleOrmEntity } from './role.orm-entity';

/**
 * TypeORM adapter implementing the RoleRepository port.
 *
 * RLS: it executes through the request-scoped EntityManager bound by the
 * RlsInterceptor (which ran `SET LOCAL app.current_tenant`), so every statement
 * is inside the tenant-scoped transaction — `roles` and `role_permissions` are
 * both filtered to the current tenant. When no request-scoped runner exists
 * (e.g. a background job), it falls back to the DataSource manager.
 *
 * The cursor encodes the last row's `(createdAt,id)` so paging is stable.
 */
@Injectable()
export class TypeOrmRoleRepository implements RoleRepository {
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

  public async save(role: Role): Promise<void> {
    const orm = RoleMapper.toOrm(role);
    // Atomic optimistic-concurrency CAS before the full write so a concurrent
    // grant/revoke on the same role can't lose an update (DESIGN §8.1). The CAS
    // takes the row lock; the cascaded role_permissions write then runs under it.
    await guardOptimisticLock(this.manager, RoleOrmEntity, orm.id, orm.version);
    await this.manager.getRepository(RoleOrmEntity).save(orm);
  }

  public async findById(id: RoleId): Promise<Role | null> {
    const row = await this.manager
      .getRepository(RoleOrmEntity)
      .findOne({ where: { id: id.toString() } });
    return row ? RoleMapper.toDomain(row) : null;
  }

  public async findByKey(key: string): Promise<Role | null> {
    const row = await this.manager.getRepository(RoleOrmEntity).findOne({ where: { key } });
    return row ? RoleMapper.toDomain(row) : null;
  }

  public async list(query: PageQuery): Promise<CursorPage<Role>> {
    // Order by ENTITY PROPERTY names (createdAt/id), not DB column names: with a
    // joined collection (leftJoinAndSelect), TypeORM's getMany() resolves the
    // orderBy aliases against entity metadata to build the distinct-id paging,
    // and a raw column name there throws "Cannot read ... 'databaseName'".
    const qb = this.manager
      .getRepository(RoleOrmEntity)
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.permissions', 'rp')
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .take(query.limit + 1); // fetch one extra to detect "hasMore"

    if (query.cursor) {
      const decoded = Cursor.decode(query.cursor);
      const [createdAt, id] = decoded.split('|');
      qb.where('(r.created_at, r.id) < (:createdAt, :id)', { createdAt, id });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const last = page.at(-1);
    const nextCursor =
      hasMore && last ? Cursor.encode(`${last.createdAt.toISOString()}|${last.id}`) : null;

    return makeCursorPage(
      page.map((row) => RoleMapper.toDomain(row)),
      nextCursor,
    );
  }
}
