import { type EffectivePrincipal } from '@contracts/core';

/**
 * The PIP port (DESIGN §3.2 PIP, §3.5/§3.6). Resolves a principal's EFFECTIVE
 * roles + attributes for a (tenant, scope) context — the cross-boundary inputs a
 * decision needs that the PEP does NOT already hold in-request.
 *
 * Implementations are a READ-THROUGH cache over the owner (the PAP), never the
 * owner of the data (DESIGN §3.5). The default impl is HTTP; a service could swap
 * in an event-fed local store without touching the PEP.
 */
export interface PipClient {
  /**
   * Resolve the principal's effective roles/attrs.
   *
   * @param userId    the principal (end-user `sub`)
   * @param tenantId  the active tenant context (DESIGN §6)
   * @param scope     the org-tree scope to resolve inheritance against (DESIGN §8.5)
   * @param forceFresh bypass the cache for sensitive actions (DESIGN §3.5, §9.1)
   */
  resolve(
    userId: string,
    tenantId: string,
    scope: string,
    forceFresh?: boolean,
  ): Promise<EffectivePrincipal>;
}

/** DI token for the PipClient port. */
export const PIP_CLIENT = Symbol('PIP_CLIENT');
