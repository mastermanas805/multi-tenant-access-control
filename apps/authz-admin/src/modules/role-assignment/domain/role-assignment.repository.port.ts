import { type CursorPage, type PageQuery } from '@kernel/core';

import { type RoleAssignment } from './role-assignment.entity';
import { type RoleAssignmentId } from './value-objects/role-assignment-id.vo';

/**
 * Repository PORT for the RoleAssignment aggregate. The domain/application layers
 * depend ONLY on this interface; the TypeORM adapter in the infrastructure layer
 * implements it. This is the seam that keeps the dependency rule intact.
 *
 * All lookups are implicitly tenant-scoped: RLS (DESIGN §6) restricts every row
 * to the ambient tenant, so use-cases never pass a tenantId to filter.
 */
export interface RoleAssignmentRepository {
  /** Persists a new or updated aggregate (the adapter decides insert vs update). */
  save(assignment: RoleAssignment): Promise<void>;

  /** Loads an assignment by id, or null when absent (or invisible under RLS). */
  findById(id: RoleAssignmentId): Promise<RoleAssignment | null>;

  /**
   * Finds an existing ACTIVE assignment for the (user, role, scope) triple, used
   * for the uniqueness check on assign. Returns null when none exists.
   */
  findActiveAssignment(
    userId: string,
    roleId: string,
    scope: string,
  ): Promise<RoleAssignment | null>;

  /** Cursor-paginated list of a single user's assignments (most-recent first). */
  listForUser(userId: string, query: PageQuery): Promise<CursorPage<RoleAssignment>>;
}

/**
 * DI token for the repository port. Use-cases inject this token (not the class)
 * so they remain framework- and persistence-agnostic.
 */
export const ROLE_ASSIGNMENT_REPOSITORY = Symbol('ROLE_ASSIGNMENT_REPOSITORY');
