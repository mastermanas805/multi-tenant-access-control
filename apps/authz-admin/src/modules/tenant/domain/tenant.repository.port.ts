import { type CursorPage, type PageQuery } from '@kernel/core';

import { type Tenant } from './tenant.entity';
import { type TenantId } from './value-objects/tenant-id.vo';

/**
 * Repository PORT for the Tenant aggregate. The domain/application layers depend
 * ONLY on this interface; the TypeORM adapter in the infrastructure layer
 * implements it. This is the seam that keeps the dependency rule intact.
 */
export interface TenantRepository {
  /** Persists a new or updated aggregate (the adapter decides insert vs update). */
  save(tenant: Tenant): Promise<void>;

  /** Loads a tenant by id, or null when absent (or invisible under RLS). */
  findById(id: TenantId): Promise<Tenant | null>;

  /** Loads a tenant by its unique slug, or null. Used for uniqueness checks. */
  findBySlug(slug: string): Promise<Tenant | null>;

  /** Cursor-paginated list of tenants (most-recent first). */
  list(query: PageQuery): Promise<CursorPage<Tenant>>;
}

/**
 * DI token for the repository port. Use-cases inject this token (not the class)
 * so they remain framework- and persistence-agnostic.
 */
export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');
