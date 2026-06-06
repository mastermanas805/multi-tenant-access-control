import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { type CursorPage, Cursor, type PageQuery, makeCursorPage } from '@kernel/core';

import { DATA_SOURCE } from '../../../shared/infrastructure/database/data-source';
import { guardOptimisticLock } from '../../../shared/infrastructure/database/optimistic-persist';
import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { type OrgUnit } from '../domain/org-unit.entity';
import { type OrgUnitRepository } from '../domain/org-unit.repository.port';
import { type OrgPath } from '../domain/value-objects/org-path.vo';
import { type OrgUnitId } from '../domain/value-objects/org-unit-id.vo';
import { OrgUnitMapper } from './org-unit.mapper';
import { OrgUnitOrmEntity } from './org-unit.orm-entity';

/**
 * TypeORM adapter implementing the OrgUnitRepository port.
 *
 * RLS: every statement runs through the request-scoped EntityManager bound by
 * the RlsInterceptor (which ran `SET LOCAL app.current_tenant`), so all reads
 * and writes are tenant-isolated. Falls back to the DataSource manager only when
 * there is no request-scoped runner (e.g. a background job).
 *
 * Subtree reads use a path-prefix predicate (DESIGN §8.5); at the DB layer this
 * is served by the ltree GiST / text_pattern_ops index on `path`.
 */
@Injectable()
export class TypeOrmOrgUnitRepository implements OrgUnitRepository {
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

  public async save(orgUnit: OrgUnit): Promise<void> {
    const orm = OrgUnitMapper.toOrm(orgUnit);
    // Atomic optimistic-concurrency CAS before the full write (DESIGN §8.1).
    await guardOptimisticLock(this.manager, OrgUnitOrmEntity, orm.id, orm.version);
    await this.manager.getRepository(OrgUnitOrmEntity).save(orm);
  }

  public async saveMany(orgUnits: readonly OrgUnit[]): Promise<void> {
    const rows = orgUnits.map((unit) => OrgUnitMapper.toOrm(unit));
    // Runs inside the request-scoped RLS transaction (DESIGN §8.5 reorg atomicity).
    // Each node carries its own bumped version; the CAS on every node makes the
    // whole subtree rewrite lose-update-safe (a concurrent edit to any node in the
    // moved subtree fails the move with a 409 instead of being silently clobbered).
    for (const row of rows) {
      await guardOptimisticLock(this.manager, OrgUnitOrmEntity, row.id, row.version);
    }
    await this.manager.getRepository(OrgUnitOrmEntity).save(rows);
  }

  public async findById(id: OrgUnitId): Promise<OrgUnit | null> {
    const row = await this.manager
      .getRepository(OrgUnitOrmEntity)
      .findOne({ where: { id: id.toString() } });
    return row ? OrgUnitMapper.toDomain(row) : null;
  }

  public async findByPath(path: OrgPath): Promise<OrgUnit | null> {
    const row = await this.manager
      .getRepository(OrgUnitOrmEntity)
      .findOne({ where: { path: path.toString() } });
    return row ? OrgUnitMapper.toDomain(row) : null;
  }

  public async listSubtree(rootPath: OrgPath, query: PageQuery): Promise<CursorPage<OrgUnit>> {
    const root = rootPath.toString();
    const qb = this.manager
      .getRepository(OrgUnitOrmEntity)
      .createQueryBuilder('o')
      .where('(o.path = :root OR o.path LIKE :prefix)', { root, prefix: `${root}.%` })
      .orderBy('o.path', 'ASC')
      .addOrderBy('o.id', 'ASC')
      .take(query.limit + 1); // fetch one extra to detect "hasMore"

    if (query.cursor) {
      const decoded = Cursor.decode(query.cursor);
      const [path, id] = decoded.split('|');
      qb.andWhere('(o.path, o.id) > (:path, :id)', { path, id });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const last = page.at(-1);
    const nextCursor = hasMore && last ? Cursor.encode(`${last.path}|${last.id}`) : null;

    return makeCursorPage(
      page.map((row) => OrgUnitMapper.toDomain(row)),
      nextCursor,
    );
  }

  public async findDescendants(path: OrgPath): Promise<OrgUnit[]> {
    const rows = await this.manager
      .getRepository(OrgUnitOrmEntity)
      .createQueryBuilder('o')
      .where('o.path LIKE :prefix', { prefix: `${path.toString()}.%` })
      .orderBy('o.path', 'ASC')
      .getMany();
    return rows.map((row) => OrgUnitMapper.toDomain(row));
  }
}
