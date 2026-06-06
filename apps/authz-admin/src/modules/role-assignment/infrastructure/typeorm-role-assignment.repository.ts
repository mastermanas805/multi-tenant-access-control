import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { type CursorPage, Cursor, type PageQuery, makeCursorPage } from '@kernel/core';

import { DATA_SOURCE } from '../../../shared/infrastructure/database/data-source';
import { guardOptimisticLock } from '../../../shared/infrastructure/database/optimistic-persist';
import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { RoleAssignmentStatus, type RoleAssignment } from '../domain/role-assignment.entity';
import { type RoleAssignmentRepository } from '../domain/role-assignment.repository.port';
import { type RoleAssignmentId } from '../domain/value-objects/role-assignment-id.vo';
import { RoleAssignmentMapper } from './role-assignment.mapper';
import { RoleAssignmentOrmEntity } from './role-assignment.orm-entity';

/**
 * TypeORM adapter implementing the RoleAssignmentRepository port.
 *
 * RLS: it executes through the request-scoped EntityManager bound by the
 * RlsInterceptor (which ran `SET LOCAL app.current_tenant`), so every statement
 * is inside the tenant-scoped transaction. When no request-scoped runner exists
 * (e.g. a background job), it falls back to the DataSource manager.
 *
 * The cursor encodes the last row's `(createdAt,id)` so paging is stable.
 */
@Injectable()
export class TypeOrmRoleAssignmentRepository implements RoleAssignmentRepository {
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

  public async save(assignment: RoleAssignment): Promise<void> {
    const orm = RoleAssignmentMapper.toOrm(assignment);
    // Atomic optimistic-concurrency CAS before the full write so a concurrent
    // revoke vs add-permission on the same assignment can't lose an update
    // (DESIGN §8.1).
    await guardOptimisticLock(this.manager, RoleAssignmentOrmEntity, orm.id, orm.version);
    await this.manager.getRepository(RoleAssignmentOrmEntity).save(orm);
  }

  public async findById(id: RoleAssignmentId): Promise<RoleAssignment | null> {
    const row = await this.manager
      .getRepository(RoleAssignmentOrmEntity)
      .findOne({ where: { id: id.toString() } });
    return row ? RoleAssignmentMapper.toDomain(row) : null;
  }

  public async findActiveAssignment(
    userId: string,
    roleId: string,
    scope: string,
  ): Promise<RoleAssignment | null> {
    const row = await this.manager.getRepository(RoleAssignmentOrmEntity).findOne({
      where: { userId, roleId, scope, status: RoleAssignmentStatus.Active },
    });
    return row ? RoleAssignmentMapper.toDomain(row) : null;
  }

  public async listForUser(userId: string, query: PageQuery): Promise<CursorPage<RoleAssignment>> {
    const qb = this.manager
      .getRepository(RoleAssignmentOrmEntity)
      .createQueryBuilder('ra')
      .where('ra.user_id = :userId', { userId })
      .orderBy('ra.created_at', 'DESC')
      .addOrderBy('ra.id', 'DESC')
      .take(query.limit + 1); // fetch one extra to detect "hasMore"

    if (query.cursor) {
      const decoded = Cursor.decode(query.cursor);
      const [createdAt, id] = decoded.split('|');
      qb.andWhere('(ra.created_at, ra.id) < (:createdAt, :id)', { createdAt, id });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const last = page.at(-1);
    const nextCursor =
      hasMore && last ? Cursor.encode(`${last.createdAt.toISOString()}|${last.id}`) : null;

    return makeCursorPage(
      page.map((row) => RoleAssignmentMapper.toDomain(row)),
      nextCursor,
    );
  }
}
