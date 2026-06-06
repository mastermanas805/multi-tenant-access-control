import { Permission } from '../domain/permission.entity';
import { PermissionOrmEntity } from './permission.orm-entity';

/**
 * Translates between the Permission aggregate and its TypeORM row. This is the
 * only place that knows both shapes, keeping the domain free of persistence
 * concerns.
 */
export const PermissionMapper = {
  /** Aggregate -> ORM row (for persistence). */
  toOrm(permission: Permission): PermissionOrmEntity {
    const orm = new PermissionOrmEntity();
    orm.id = permission.id.toString();
    orm.key = permission.key.toString();
    orm.description = permission.description;
    orm.version = permission.version;
    orm.createdAt = permission.createdAt;
    orm.updatedAt = permission.updatedAt;
    return orm;
  },

  /** ORM row -> aggregate (rehydration via the aggregate's snapshot factory). */
  toDomain(orm: PermissionOrmEntity): Permission {
    return Permission.fromSnapshot({
      id: orm.id,
      key: orm.key,
      description: orm.description,
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  },
} as const;
