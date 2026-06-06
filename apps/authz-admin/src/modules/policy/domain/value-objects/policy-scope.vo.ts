import { Guard } from '@kernel/core';

/**
 * Policy scope path (DESIGN §8.5). Scopes ARE org-tree paths
 * (e.g. `acme.finance.emea`) and map 1:1 to Cerbos resource-policy scopes.
 * Validated as dot-separated lowercase alphanumeric segments, depth-bounded
 * (≤8) to cap traversal (DESIGN §8.5).
 */
const SCOPE_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/;
const MAX_SCOPE_DEPTH = 8;

/** Value object wrapping the policy scope path with validation + helpers. */
export class PolicyScope {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Validates and wraps a raw scope string (e.g. from a request DTO). */
  public static fromString(value: string): PolicyScope {
    Guard.againstEmpty(value, 'scope');
    Guard.invariant(
      SCOPE_PATTERN.test(value),
      'scope must be a dot-separated path of lowercase alphanumeric segments',
      'scope_format',
    );
    Guard.invariant(
      value.split('.').length <= MAX_SCOPE_DEPTH,
      `scope depth must not exceed ${String(MAX_SCOPE_DEPTH)}`,
      'scope_too_deep',
    );
    return new PolicyScope(value);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other?: PolicyScope): boolean {
    return this.value === other?.value;
  }
}
