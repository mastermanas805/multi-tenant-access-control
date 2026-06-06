import { ConflictError, NotFoundError } from '@kernel/core';

/** The requested tenant does not exist (or is invisible under RLS). -> 404 */
export class TenantNotFoundError extends NotFoundError {
  constructor(tenantId: string) {
    super(`Tenant ${tenantId} not found`, 'tenant_not_found');
  }
}

/** A tenant with the same slug already exists. -> 409 */
export class TenantSlugTakenError extends ConflictError {
  constructor(slug: string) {
    super(`Tenant slug "${slug}" is already taken`, 'tenant_slug_taken');
  }
}

/**
 * An operation is invalid for the tenant's current status. -> 409
 * Inherits ConflictError's (message, reason?) constructor; callers always pass a
 * reason (e.g. "tenant_already_suspended") so the envelope carries it.
 */
export class TenantStatusError extends ConflictError {}
