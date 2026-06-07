/**
 * A single active role grant that applies to a principal in a scope chain — the
 * minimal read-model the PIP needs: the role KEY (Cerbos consumes keys, not the
 * role UUID) and the SCOPE the grant was made at (so the resolver can order by
 * specificity and surface provenance). DESIGN §3.2 (PIP), §8.5 (scope chain).
 */
export interface PrincipalRoleGrant {
  /** The tenant-unique role key, e.g. `finance_manager` (NOT the role UUID). */
  readonly roleKey: string;
  /** The org-unit scope the grant was made at, e.g. `acme.finance`. */
  readonly scope: string;
}

/**
 * Read-model PORT for resolving a principal's EFFECTIVE grants (DESIGN §3.2). The
 * application layer depends ONLY on this interface; the infrastructure layer
 * implements it over `role_assignments` joined with `roles`. RLS scopes every
 * query to the ambient tenant, so callers never filter by tenant id themselves
 * (DESIGN §6).
 */
export interface PrincipalProjection {
  /**
   * All ACTIVE role grants for `userId` whose assignment scope is on the path
   * from the org root down to (and including) the requested scope — i.e. every
   * ancestor-or-self scope in `scopeChain`. This is the SCOPE INHERITANCE walk
   * (DESIGN §8.5): a role granted at a broader scope is effective at every
   * narrower scope beneath it. Expired (validUntil in the past) grants are
   * excluded by the adapter.
   *
   * @param userId      the principal (end-user `sub`)
   * @param scopeChain  ancestor-or-self scopes of the requested scope, e.g.
   *                    `['acme', 'acme.finance', 'acme.finance.emea']`
   */
  findActiveGrants(userId: string, scopeChain: string[]): Promise<PrincipalRoleGrant[]>;
}

/** DI token for the principal-projection port. */
export const PRINCIPAL_PROJECTION = Symbol('PRINCIPAL_PROJECTION');
