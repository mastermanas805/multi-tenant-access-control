import { ConflictError, NotFoundError } from '@kernel/core';

/** The requested org-unit does not exist (or is invisible under RLS). -> 404 */
export class OrgUnitNotFoundError extends NotFoundError {
  constructor(orgUnitId: string) {
    super(`OrgUnit ${orgUnitId} not found`, 'org_unit_not_found');
  }
}

/** An org-unit with the same path already exists for this tenant. -> 409 */
export class OrgUnitPathTakenError extends ConflictError {
  constructor(path: string) {
    super(`OrgUnit path "${path}" is already taken`, 'org_unit_path_taken');
  }
}

/**
 * A move would create a cycle (re-parenting a node under its own descendant). -> 409
 * Inherits ConflictError's (message, reason?) constructor.
 */
export class OrgUnitCycleError extends ConflictError {}

/**
 * A move/create would exceed the maximum hierarchy depth (DESIGN §8.5). -> 409
 * Inherits ConflictError's (message, reason?) constructor.
 */
export class OrgUnitDepthExceededError extends ConflictError {}
