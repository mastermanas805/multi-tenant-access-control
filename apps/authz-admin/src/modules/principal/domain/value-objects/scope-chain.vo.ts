import { Guard } from '@kernel/core';

/**
 * The ancestor-or-self scope chain for a requested org-unit scope (DESIGN §8.5).
 * For `acme.finance.emea` this is `['acme', 'acme.finance', 'acme.finance.emea']`
 * (root-first). The PIP resolves effective grants over this chain — a role granted
 * at any ancestor scope is effective at the requested (narrower) scope.
 *
 * Pure domain VO: validates the dot-delimited label syntax + the depth bound (≤8)
 * the storage model relies on (ltree materialized path), and imports nothing
 * framework-specific. Mirrors the ScopePath label rules used elsewhere.
 */
const LABEL_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const MAX_DEPTH = 8;

export class ScopeChain {
  private constructor(
    /** The requested (most-specific) scope. */
    private readonly requested: string,
    /** Root-first ancestor-or-self chain. */
    private readonly chain: string[],
  ) {}

  /** Validates `scope` and expands it into its root-first ancestor-or-self chain. */
  public static forScope(scope: string): ScopeChain {
    Guard.againstEmpty(scope, 'scope');
    const labels = scope.split('.');
    Guard.invariant(labels.length <= MAX_DEPTH, 'scope path too deep (max 8)', 'scope_too_deep');
    Guard.invariant(
      labels.every((label) => LABEL_PATTERN.test(label)),
      'scope path must be dot-delimited lowercase labels',
      'scope_format',
    );

    const chain: string[] = [];
    for (let cut = 1; cut <= labels.length; cut += 1) {
      chain.push(labels.slice(0, cut).join('.'));
    }
    return new ScopeChain(scope, chain);
  }

  /** The requested (most-specific) scope. */
  public get scope(): string {
    return this.requested;
  }

  /** Root-first ancestor-or-self scopes (e.g. `acme`, `acme.finance`, …). */
  public toArray(): string[] {
    return [...this.chain];
  }

  /** Specificity rank of a scope in the chain (root=0, deepest=highest). null if absent. */
  public depthOf(scope: string): number | null {
    const index = this.chain.indexOf(scope);
    return index === -1 ? null : index;
  }
}
