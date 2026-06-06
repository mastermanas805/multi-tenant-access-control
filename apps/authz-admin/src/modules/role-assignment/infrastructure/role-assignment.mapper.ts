import { RoleAssignment, type RoleAssignmentStatus } from '../domain/role-assignment.entity';
import { RoleAssignmentOrmEntity } from './role-assignment.orm-entity';

/**
 * Translates between the RoleAssignment aggregate and its TypeORM row. This is the
 * only place that knows both shapes, keeping the domain free of persistence
 * concerns.
 */
export const RoleAssignmentMapper = {
  /** Aggregate -> ORM row (for persistence). */
  toOrm(assignment: RoleAssignment): RoleAssignmentOrmEntity {
    const orm = new RoleAssignmentOrmEntity();
    orm.id = assignment.id.toString();
    orm.tenantId = assignment.tenantId;
    orm.userId = assignment.userId;
    orm.roleId = assignment.roleId;
    orm.scope = assignment.scope.toString();
    orm.status = assignment.status;
    orm.validUntil = assignment.validUntil;
    orm.delegatedBy = assignment.delegatedBy;
    orm.version = assignment.version;
    orm.createdAt = assignment.createdAt;
    orm.updatedAt = assignment.updatedAt;
    return orm;
  },

  /** ORM row -> aggregate (rehydration via the aggregate's snapshot factory). */
  toDomain(orm: RoleAssignmentOrmEntity): RoleAssignment {
    return RoleAssignment.fromSnapshot({
      id: orm.id,
      tenantId: orm.tenantId,
      userId: orm.userId,
      roleId: orm.roleId,
      scope: orm.scope,
      status: orm.status as RoleAssignmentStatus,
      validUntil: orm.validUntil,
      delegatedBy: orm.delegatedBy,
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  },
} as const;
