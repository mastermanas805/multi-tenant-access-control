import { Guard, ValidationError } from '@kernel/core';

/**
 * CANONICAL capability key, shared by the global permission CATALOG (this module)
 * and by role grants (the role module re-exports this exact VO). Formatted
 * `service:resource:action`, e.g. `expense:report:approve`.
 *
 * Grammar (reconciled — DESIGN §3, FR-4): three colon-separated segments, each
 * either lower snake-case (`[a-z0-9_]+`, e.g. `cost_center`) OR a single `*`
 * wildcard (e.g. `expense:report:*`). Underscores AND wildcards are BOTH allowed
 * so a key valid in the catalog is always valid as a role grant and vice versa —
 * the two no longer diverge. Wrapping the raw string in a value object guarantees
 * a malformed key can never reach the catalog or a role.
 */
const PERMISSION_KEY_PATTERN = /^(?:[a-z0-9_]+|\*):(?:[a-z0-9_]+|\*):(?:[a-z0-9_]+|\*)$/;

/** Stable reason code emitted on a format failure (single source of truth). */
export const PERMISSION_KEY_FORMAT_REASON = 'permission_key_format';

export class PermissionKey {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Validates and wraps a raw key string (e.g. from a request DTO). */
  public static fromString(value: string): PermissionKey {
    Guard.againstEmpty(value, 'permission');
    if (!PERMISSION_KEY_PATTERN.test(value)) {
      throw new ValidationError(
        'Permission key must match service:resource:action (lower snake-case segments, "*" wildcard allowed)',
        PERMISSION_KEY_FORMAT_REASON,
      );
    }
    return new PermissionKey(value);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other?: PermissionKey): boolean {
    return this.value === other?.value;
  }
}
