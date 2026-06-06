import { type CursorPage, type PageQuery } from '@kernel/core';

import { type Permission } from './permission.entity';
import { type PermissionId } from './value-objects/permission-id.vo';

/**
 * Repository PORT for the Permission aggregate. The domain/application layers
 * depend ONLY on this interface; the TypeORM adapter in the infrastructure
 * layer implements it. This is the seam that keeps the dependency rule intact.
 */
export interface PermissionRepository {
  /** Persists a new or updated aggregate (the adapter decides insert vs update). */
  save(permission: Permission): Promise<void>;

  /** Loads a permission by id, or null when absent. */
  findById(id: PermissionId): Promise<Permission | null>;

  /** Loads a permission by its unique key, or null. Used for uniqueness checks. */
  findByKey(key: string): Promise<Permission | null>;

  /** Cursor-paginated list of permissions (most-recent first). */
  list(query: PageQuery): Promise<CursorPage<Permission>>;
}

/**
 * DI token for the repository port. Use-cases inject this token (not the class)
 * so they remain framework- and persistence-agnostic.
 */
export const PERMISSION_REPOSITORY = Symbol('PERMISSION_REPOSITORY');
