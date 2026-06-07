import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import {
  ConflictError,
  type CursorPage,
  Cursor,
  type PageQuery,
  makeCursorPage,
} from '@kernel/core';

import { DATA_SOURCE } from '../../../shared/infrastructure/database/data-source';
import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { Policy, PolicyStatus } from '../domain/policy.entity';
import { type PolicyRepository } from '../domain/policy.repository.port';
import { type PolicyId } from '../domain/value-objects/policy-id.vo';
import { type PolicyScope } from '../domain/value-objects/policy-scope.vo';
import { PolicyMapper } from './policy.mapper';
import { PolicyOrmEntity } from './policy.orm-entity';

/**
 * TypeORM adapter implementing the PolicyRepository port.
 *
 * RLS: it executes through the request-scoped EntityManager bound by the
 * RlsInterceptor (which ran `SET LOCAL app.current_tenant`), so every statement
 * is inside the tenant-scoped transaction. When no request-scoped runner exists
 * (e.g. a background job), it falls back to the DataSource manager.
 *
 * On insert it stamps the owning `tenant_id` from the ambient tenant context,
 * keeping the application layer tenant-agnostic.
 *
 * The cursor encodes the last row's `(createdAt,id)` so paging is stable.
 */
@Injectable()
export class TypeOrmPolicyRepository implements PolicyRepository {
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

  public async save(policy: Policy): Promise<void> {
    // Stamp the owning tenant from the ambient tenant context (DESIGN §6),
    // matching the other tenant-scoped modules; rehydrated aggregates already
    // carry the value and stampTenant is idempotent for the same tenant.
    const tenantId = this.tenantContext.getTenantId();
    policy.stampTenant(tenantId);
    const orm = PolicyMapper.toOrm(policy, tenantId);
    const repository = this.manager.getRepository(PolicyOrmEntity);

    // The policy `version` is a MONOTONIC per-scope identifier, immutable per row
    // (each publish/rollback is a NEW version), so it cannot serve as an
    // optimistic-lock token. The only in-place mutation is activation
    // (staged -> active). Guard THAT atomically (DESIGN §8.1): two concurrent
    // activates serialize on the row lock and the loser gets a 409 instead of a
    // silent no-op clobber.
    if (orm.status === PolicyStatus.Active) {
      const result = await repository
        .createQueryBuilder()
        .update()
        .set({ status: PolicyStatus.Active, updatedAt: orm.updatedAt })
        .where('id = :id AND status = :staged', { id: orm.id, staged: PolicyStatus.Staged })
        .execute();

      if (result.affected === 1) {
        return; // CAS won.
      }
      const exists = await repository
        .createQueryBuilder('p')
        .where('p.id = :id', { id: orm.id })
        .getExists();
      if (exists) {
        throw new ConflictError('Policy was modified by another request', 'version_mismatch');
      }
      // No row yet (unexpected for an activate) -> fall through to insert.
    }

    // A staged publish/rollback is always a brand-new version row -> insert.
    await repository.save(orm);
  }

  public async findById(id: PolicyId): Promise<Policy | null> {
    const row = await this.manager
      .getRepository(PolicyOrmEntity)
      .findOne({ where: { id: id.toString() } });
    return row ? PolicyMapper.toDomain(row) : null;
  }

  public async findLatestForScope(scope: PolicyScope): Promise<Policy | null> {
    const row = await this.manager
      .getRepository(PolicyOrmEntity)
      .findOne({ where: { scope: scope.toString() }, order: { version: 'DESC' } });
    return row ? PolicyMapper.toDomain(row) : null;
  }

  public async findByScopeAndVersion(scope: PolicyScope, version: number): Promise<Policy | null> {
    const row = await this.manager
      .getRepository(PolicyOrmEntity)
      .findOne({ where: { scope: scope.toString(), version } });
    return row ? PolicyMapper.toDomain(row) : null;
  }

  public async list(query: PageQuery): Promise<CursorPage<Policy>> {
    const qb = this.manager
      .getRepository(PolicyOrmEntity)
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
      page.map((row) => PolicyMapper.toDomain(row)),
      nextCursor,
    );
  }
}
