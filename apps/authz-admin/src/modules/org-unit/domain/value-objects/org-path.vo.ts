import { Guard, ValidationError } from '@kernel/core';

/**
 * Materialized path of an org-unit node (DESIGN §8.5), e.g. `acme.finance.emea`.
 * Maps 1:1 to a Cerbos scope. Stored as text and indexed for prefix/subtree
 * queries (ltree / text_pattern_ops at the DB layer).
 *
 * Invariants enforced here:
 *   - dot-delimited, each segment lower-kebab `[a-z0-9](-[a-z0-9])*`,
 *   - at least one segment (the root),
 *   - depth <= MAX_DEPTH (8) — caps traversal (DESIGN §8.5).
 */
const SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class OrgPath {
  /** Maximum number of path segments (depth cap, DESIGN §8.5). */
  public static readonly MAX_DEPTH = 8;

  /** The separator between path segments. */
  public static readonly SEPARATOR = '.';

  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Validates and wraps a raw dotted path string (e.g. from a request DTO). */
  public static fromString(value: string): OrgPath {
    Guard.againstEmpty(value, 'path');
    const segments = value.split(OrgPath.SEPARATOR);
    if (segments.length > OrgPath.MAX_DEPTH) {
      throw new ValidationError(
        `path depth must be <= ${String(OrgPath.MAX_DEPTH)}`,
        'org_path_too_deep',
      );
    }
    for (const segment of segments) {
      if (!SEGMENT_PATTERN.test(segment)) {
        throw new ValidationError(
          `path segment "${segment}" must be lower-kebab-case`,
          'org_path_segment_invalid',
        );
      }
    }
    return new OrgPath(value);
  }

  /** Builds a child path by appending a single validated segment to this path. */
  public child(segment: string): OrgPath {
    return OrgPath.fromString(`${this.value}${OrgPath.SEPARATOR}${segment}`);
  }

  /** The individual segments, root-first. */
  public get segments(): readonly string[] {
    return this.value.split(OrgPath.SEPARATOR);
  }

  /** Number of segments (1 = a root node). */
  public get depth(): number {
    return this.segments.length;
  }

  /** The leaf segment (the node's own name within its parent). */
  public get leaf(): string {
    const segments = this.segments;
    return segments[segments.length - 1] ?? this.value;
  }

  /** True when `other` is this path or a descendant of it (prefix match). */
  public isAncestorOf(other: OrgPath): boolean {
    return (
      other.value === this.value || other.value.startsWith(`${this.value}${OrgPath.SEPARATOR}`)
    );
  }

  public toString(): string {
    return this.value;
  }

  public equals(other?: OrgPath): boolean {
    return this.value === other?.value;
  }
}
