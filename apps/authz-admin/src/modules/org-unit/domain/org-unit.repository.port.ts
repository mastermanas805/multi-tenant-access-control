import { type CursorPage, type PageQuery } from '@kernel/core';

import { type OrgUnit } from './org-unit.entity';
import { type OrgPath } from './value-objects/org-path.vo';
import { type OrgUnitId } from './value-objects/org-unit-id.vo';

/**
 * Repository PORT for the OrgUnit aggregate. The domain/application layers depend
 * ONLY on this interface; the TypeORM adapter in the infrastructure layer
 * implements it. All reads/writes are implicitly tenant-scoped via RLS (the
 * adapter resolves the EntityManager through the tenant context — DESIGN §6).
 */
export interface OrgUnitRepository {
  /** Persists a new or updated aggregate (the adapter decides insert vs update). */
  save(orgUnit: OrgUnit): Promise<void>;

  /** Persists many aggregates atomically — used for subtree path rewrites. */
  saveMany(orgUnits: readonly OrgUnit[]): Promise<void>;

  /** Loads an org-unit by id, or null when absent (or invisible under RLS). */
  findById(id: OrgUnitId): Promise<OrgUnit | null>;

  /** Loads an org-unit by its (tenant-unique) path, or null. Uniqueness checks. */
  findByPath(path: OrgPath): Promise<OrgUnit | null>;

  /** All nodes in the subtree rooted at `rootPath` (the root itself + descendants). */
  listSubtree(rootPath: OrgPath, query: PageQuery): Promise<CursorPage<OrgUnit>>;

  /** Strict descendants of `path` (excludes the node itself); for subtree rewrites. */
  findDescendants(path: OrgPath): Promise<OrgUnit[]>;
}

/**
 * DI token for the repository port. Use-cases inject this token (not the class)
 * so they remain framework- and persistence-agnostic.
 */
export const ORG_UNIT_REPOSITORY = Symbol('ORG_UNIT_REPOSITORY');
