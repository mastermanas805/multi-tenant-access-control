import { OrgUnit } from '../domain/org-unit.entity';
import { OrgUnitOrmEntity } from './org-unit.orm-entity';

/**
 * Translates between the OrgUnit aggregate and its TypeORM row. The only place
 * that knows both shapes, keeping the domain free of persistence concerns.
 */
export const OrgUnitMapper = {
  /** Aggregate -> ORM row (for persistence). */
  toOrm(orgUnit: OrgUnit): OrgUnitOrmEntity {
    const orm = new OrgUnitOrmEntity();
    orm.id = orgUnit.id.toString();
    orm.tenantId = orgUnit.tenantId;
    orm.parentId = orgUnit.parentId;
    orm.path = orgUnit.path.toString();
    orm.name = orgUnit.name;
    orm.version = orgUnit.version;
    orm.createdAt = orgUnit.createdAt;
    orm.updatedAt = orgUnit.updatedAt;
    return orm;
  },

  /** ORM row -> aggregate (rehydration via the aggregate's snapshot factory). */
  toDomain(orm: OrgUnitOrmEntity): OrgUnit {
    return OrgUnit.fromSnapshot({
      id: orm.id,
      tenantId: orm.tenantId,
      parentId: orm.parentId,
      path: orm.path,
      name: orm.name,
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  },
} as const;
