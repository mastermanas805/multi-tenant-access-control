import { Guard } from '@kernel/core';

/**
 * Hierarchical scope path (DESIGN §3, §8.5) — a dot-delimited org-unit path such
 * as `acme.finance.emea`. Scopes ARE paths, mapping 1:1 to Cerbos scopes; this
 * VO enforces the label syntax and the depth bound (≤8) the storage model relies
 * on (DESIGN §8.5: ltree materialized path, depth-bounded to cap traversal).
 */
const LABEL_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const MAX_DEPTH = 8;

export class ScopePath {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Validates and wraps a raw scope path (e.g. from a request DTO). */
  public static fromString(value: string): ScopePath {
    Guard.againstEmpty(value, 'scope');
    const labels = value.split('.');
    Guard.invariant(labels.length <= MAX_DEPTH, 'scope path too deep (max 8)', 'scope_too_deep');
    Guard.invariant(
      labels.every((label) => LABEL_PATTERN.test(label)),
      'scope path must be dot-delimited lowercase labels',
      'scope_format',
    );
    return new ScopePath(value);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other?: ScopePath): boolean {
    return this.value === other?.value;
  }
}
