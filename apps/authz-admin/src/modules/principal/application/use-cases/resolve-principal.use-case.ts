import { Inject, Injectable } from '@nestjs/common';

import { TenantContextService } from '../../../../shared/infrastructure/database/tenant-context';
import {
  type PrincipalProjection,
  type PrincipalRoleGrant,
  PRINCIPAL_PROJECTION,
} from '../../domain/principal-projection.port';
import { ScopeChain } from '../../domain/value-objects/scope-chain.vo';
import { type ResolvePrincipalQuery } from '../dto/principal.commands';
import { type PrincipalView } from '../dto/principal.view';

/**
 * Resolves a principal's EFFECTIVE roles + attributes for a (tenant, scope)
 * context — the PIP source the Expense PEP reads via @authz/pep's HttpPipClient
 * (DESIGN §3.2, §3.5):
 *
 *   GET /v1/principals/:userId/effective?tenantId=&scope=
 *
 * Algorithm:
 *   1. expand the requested scope into its root-first ancestor-or-self chain
 *      (SCOPE INHERITANCE — a role granted at a broader scope is effective at the
 *      requested narrower scope, DESIGN §8.5);
 *   2. load the principal's ACTIVE grants whose assignment scope is in that chain
 *      (the projection joins role_assignments -> roles to return role KEYS);
 *   3. dedupe role keys, ordering MOST-SPECIFIC-FIRST (per the EffectivePrincipal
 *      contract) so the nearest grant wins for display;
 *   4. build `attr` with the ambient `tenantId` (DESIGN §6 guardrail input) plus a
 *      best-effort `department` projection (see below).
 *
 * Tenant-agnostic: RLS scopes every read to the ambient tenant; the tenantId on
 * the response is read from the ambient context, never the body (DESIGN §6).
 *
 * `department`: the PAP does not OWN HR attributes (DESIGN §3.6 — those belong to
 * the User/HR service, which the PEP merges in). As a faithful, NON-hardcoded
 * projection so the demo ABAC condition is satisfiable, department is derived from
 * the org-unit segment beneath the tenant root of the principal's most-specific
 * grant scope (e.g. a grant at `acme.finance.emea` -> department `finance`). It is
 * omitted when there is no grant below the root. A production deployment overrides
 * this attribute from the HR source.
 */
@Injectable()
export class ResolvePrincipalUseCase {
  constructor(
    @Inject(PRINCIPAL_PROJECTION) private readonly projection: PrincipalProjection,
    private readonly tenantContext: TenantContextService,
  ) {}

  public async execute(query: ResolvePrincipalQuery): Promise<PrincipalView> {
    const tenantId = this.tenantContext.getTenantId();
    const scopeChain = ScopeChain.forScope(query.scope);

    const grants = await this.projection.findActiveGrants(query.userId, scopeChain.toArray());

    const roles = dedupeMostSpecificFirst(grants, scopeChain);
    const department = deriveDepartment(grants, scopeChain);

    const attr: Record<string, unknown> = {
      tenantId,
      ...(department !== null ? { department } : {}),
    };

    return { id: query.userId, tenantId, roles, attr };
  }
}

/**
 * Dedupes role keys, ordering by the SPECIFICITY of the grant scope (deepest
 * first). When the same role key is granted at multiple scopes, its most-specific
 * grant determines its rank; first-seen wins for equal specificity (stable).
 */
function dedupeMostSpecificFirst(grants: PrincipalRoleGrant[], chain: ScopeChain): string[] {
  const bestDepthByRole = new Map<string, number>();
  for (const grant of grants) {
    const depth = chain.depthOf(grant.scope) ?? -1;
    const current = bestDepthByRole.get(grant.roleKey);
    if (current === undefined || depth > current) {
      bestDepthByRole.set(grant.roleKey, depth);
    }
  }
  return [...bestDepthByRole.entries()].sort((a, b) => b[1] - a[1]).map(([roleKey]) => roleKey);
}

/**
 * Best-effort department projection: the org-unit label directly beneath the
 * tenant root of the principal's MOST-SPECIFIC grant scope. `acme.finance.emea` ->
 * `finance`; a root-only grant (`acme`) -> null. See the use-case doc for the HR
 * ownership caveat (DESIGN §3.6).
 */
function deriveDepartment(grants: PrincipalRoleGrant[], chain: ScopeChain): string | null {
  let deepest: { scope: string; depth: number } | null = null;
  for (const grant of grants) {
    const depth = chain.depthOf(grant.scope) ?? -1;
    if (deepest === null || depth > deepest.depth) {
      deepest = { scope: grant.scope, depth };
    }
  }
  if (deepest === null) {
    return null;
  }
  const labels = deepest.scope.split('.');
  return labels.length >= 2 ? (labels[1] ?? null) : null;
}
