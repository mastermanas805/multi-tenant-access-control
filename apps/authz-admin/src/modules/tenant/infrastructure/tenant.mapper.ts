import { Tenant, type TenantStatus } from '../domain/tenant.entity';
import { TenantOrmEntity } from './tenant.orm-entity';

/**
 * Translates between the Tenant aggregate and its TypeORM row. This is the only
 * place that knows both shapes, keeping the domain free of persistence concerns.
 */
export const TenantMapper = {
  /** Aggregate -> ORM row (for persistence). */
  toOrm(tenant: Tenant): TenantOrmEntity {
    const orm = new TenantOrmEntity();
    orm.id = tenant.id.toString();
    orm.name = tenant.name;
    orm.slug = tenant.slug;
    orm.status = tenant.status;
    orm.isolationTier = tenant.isolationTier.toString();
    orm.version = tenant.version;
    orm.createdAt = tenant.createdAt;
    orm.updatedAt = tenant.updatedAt;
    return orm;
  },

  /** ORM row -> aggregate (rehydration via the aggregate's snapshot factory). */
  toDomain(orm: TenantOrmEntity): Tenant {
    return Tenant.fromSnapshot({
      id: orm.id,
      name: orm.name,
      slug: orm.slug,
      status: orm.status as TenantStatus,
      isolationTier: orm.isolationTier,
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  },
} as const;
