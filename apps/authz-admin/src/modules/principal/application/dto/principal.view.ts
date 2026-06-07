import { type EffectivePrincipal } from '@contracts/core';

/**
 * The PIP read-model view returned by ResolvePrincipalUseCase. It is exactly the
 * shared `EffectivePrincipal` contract (the PAP /effective response = the PIP read
 * model the Expense PEP's HttpPipClient consumes — DESIGN §3.2, §3.5). Aliased
 * here so the application layer names its own return type while the wire shape
 * stays the single source of truth in @contracts/core.
 */
export type PrincipalView = EffectivePrincipal;
