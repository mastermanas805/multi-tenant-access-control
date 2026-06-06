import { type CursorPage, type PageQuery } from '@kernel/core';

import { type Role } from './role.entity';
import { type RoleId } from './value-objects/role-id.vo';

/**
 * Repository PORT for the Role aggregate. The domain/application layers depend
 * ONLY on this interface; the TypeORM adapter in the infrastructure layer
 * implements it. This is the seam that keeps the dependency rule intact.
 *
 * Every method runs inside the request's tenant-scoped transaction (RLS), so the
 * repository is tenant-agnostic — it never filters by tenant id explicitly.
 */
export interface RoleRepository {
  /** Persists a new or updated aggregate (the adapter decides insert vs update). */
  save(role: Role): Promise<void>;

  /** Loads a role by id, or null when absent (or invisible under RLS). */
  findById(id: RoleId): Promise<Role | null>;

  /** Loads a role by its tenant-unique key, or null. Used for uniqueness checks. */
  findByKey(key: string): Promise<Role | null>;

  /** Cursor-paginated list of roles (most-recent first). */
  list(query: PageQuery): Promise<CursorPage<Role>>;
}

/**
 * DI token for the repository port. Use-cases inject this token (not the class)
 * so they remain framework- and persistence-agnostic.
 */
export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');
