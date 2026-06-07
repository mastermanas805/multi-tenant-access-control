import { SetMetadata } from '@nestjs/common';
import { type Request } from 'express';

import { type AttributeBag } from '@contracts/core';

import { type AuthzPrincipalContext } from './authz-request-context';

/**
 * What a resource loader returns: the resource identity + the attributes the PDP
 * needs (DESIGN §3.5 — loaded in-request from the owning service's own DB, always
 * fresh). `attr` MUST include `tenantId` so the PEP's tenant guardrail can fire
 * (DESIGN §3.1, §6). `scope` (optional) selects the scoped policy chain (§8.5).
 */
export interface LoadedResource {
  readonly id: string;
  readonly attr: AttributeBag & { readonly tenantId: string };
  /** Org-tree scope path to evaluate against (e.g. `acme.finance`). */
  readonly scope?: string;
}

/** Context handed to a resource loader so it can read route params / the principal. */
export interface ResourceLoaderContext {
  readonly request: Request;
  readonly principal: AuthzPrincipalContext;
}

/**
 * Pluggable resource loader (DESIGN §3.5/§3.6): each service supplies HOW to load
 * its own resource (e.g. `req.params.id` → its repository), keeping the PEP
 * domain-agnostic. Returns the loaded resource, or `null` when it does not exist
 * (the PEP maps that to a 404 — never an authz allow).
 */
export type ResourceLoader = (
  ctx: ResourceLoaderContext,
) => Promise<LoadedResource | null> | LoadedResource | null;

/** Options for the @Authorize decorator. */
export interface AuthorizeOptions {
  /** The action(s) to check, e.g. `'approve'` or `['read','approve']` (DESIGN §8.2 bulk). */
  readonly action: string | string[];
  /** The Cerbos resource kind, e.g. `expense_report` (DESIGN §3.1). */
  readonly resourceKind: string;
  /** How to load the resource (+ its in-request attrs) for this route. */
  readonly loadResource: ResourceLoader;
  /**
   * Force a fresh PIP read, bypassing the cache (DESIGN §3.5, §9.1) — set for
   * SENSITIVE/money-movement actions (e.g. approve) so a just-revoked role is
   * enforced immediately. Default false.
   */
  readonly sensitive?: boolean;
}

/** Metadata key the AuthzGuard reads to find the route's authorization spec. */
export const AUTHORIZE_METADATA = Symbol('AUTHORIZE_METADATA');

/**
 * Marks a route handler for PEP enforcement (DESIGN §3.2 PEP). Pair with
 * `@UseGuards(AuthzGuard)`. The guard reads this metadata, loads the resource,
 * runs the tenant guardrail, resolves principal attrs via the PIP, calls the PDP,
 * and on DENY throws a ForbiddenError carrying the reason + decisionId so the
 * global filter renders the §8.1 envelope.
 *
 * @example
 *   @Post(':id/approve')
 *   @UseGuards(AuthzGuard)
 *   @Authorize({
 *     action: 'approve',
 *     resourceKind: EXPENSE_RESOURCE_KIND,
 *     sensitive: true,
 *     loadResource: async ({ request }) => {
 *       const e = await expenses.byId(request.params.id);
 *       return e && { id: e.id, scope: e.scope,
 *         attr: { tenantId: e.tenantId, amount: e.amount, department: e.department } };
 *     },
 *   })
 *   approve(...) { ... }
 */
export const Authorize = (options: AuthorizeOptions): MethodDecorator =>
  SetMetadata(AUTHORIZE_METADATA, options);
