import { Role } from '../domain/role.entity';
import { RolePermissionOrmEntity } from './role-permission.orm-entity';
import { RoleOrmEntity } from './role.orm-entity';

/**
 * Translates between the Role aggregate and its TypeORM rows. This is the only
 * place that knows both shapes, keeping the domain free of persistence concerns.
 * The permission set maps to child rows in `role_permissions`; both the role and
 * its join rows carry the aggregate's tenant_id (RLS — DESIGN §6).
 */
export const RoleMapper = {
  /** Aggregate -> ORM rows (for persistence). */
  toOrm(role: Role): RoleOrmEntity {
    const orm = new RoleOrmEntity();
    orm.id = role.id.toString();
    orm.tenantId = role.tenantId;
    orm.key = role.key;
    orm.scope = role.scope;
    orm.description = role.description;
    orm.version = role.version;
    orm.createdAt = role.createdAt;
    orm.updatedAt = role.updatedAt;
    orm.permissions = role.permissions.map((permission) => {
      const rp = new RolePermissionOrmEntity();
      rp.roleId = role.id.toString();
      rp.permission = permission;
      rp.tenantId = role.tenantId;
      return rp;
    });
    return orm;
  },

  /** ORM rows -> aggregate (rehydration via the aggregate's snapshot factory). */
  toDomain(orm: RoleOrmEntity): Role {
    return Role.fromSnapshot({
      id: orm.id,
      tenantId: orm.tenantId,
      key: orm.key,
      scope: orm.scope,
      description: orm.description,
      permissions: (orm.permissions ?? []).map((rp) => rp.permission),
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  },
} as const;
