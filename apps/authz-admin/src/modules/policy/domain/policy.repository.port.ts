import { type CursorPage, type PageQuery } from '@kernel/core';

import { type Policy } from './policy.entity';
import { type PolicyId } from './value-objects/policy-id.vo';
import { type PolicyScope } from './value-objects/policy-scope.vo';

/**
 * Repository PORT for the Policy aggregate. The domain/application layers depend
 * ONLY on this interface; the TypeORM adapter in the infrastructure layer
 * implements it. This is the seam that keeps the dependency rule intact.
 *
 * RLS scopes every query to the ambient tenant, so callers never filter by
 * tenantId themselves (DESIGN §6).
 */
export interface PolicyRepository {
  /** Persists a new or updated aggregate (the adapter decides insert vs update). */
  save(policy: Policy): Promise<void>;

  /** Loads a policy by id, or null when absent (or invisible under RLS). */
  findById(id: PolicyId): Promise<Policy | null>;

  /**
   * Highest version currently published for a scope, or null when the scope has
   * none yet. Used to compute the next monotonic version on publish/rollback.
   */
  findLatestForScope(scope: PolicyScope): Promise<Policy | null>;

  /**
   * A specific published version of a scope, or null. Used by rollback to load
   * the rule of the target version.
   */
  findByScopeAndVersion(scope: PolicyScope, version: number): Promise<Policy | null>;

  /** Cursor-paginated list of policies (most-recent first). */
  list(query: PageQuery): Promise<CursorPage<Policy>>;
}

/**
 * DI token for the repository port. Use-cases inject this token (not the class)
 * so they remain framework- and persistence-agnostic.
 */
export const POLICY_REPOSITORY = Symbol('POLICY_REPOSITORY');
