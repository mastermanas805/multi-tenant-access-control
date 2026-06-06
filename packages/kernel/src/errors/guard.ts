import { ValidationError } from './domain-error';

/**
 * Standalone invariant for ergonomic call sites: `invariant(x > 0, 'must be positive')`.
 * Declared as a function (not an object method) so TypeScript accepts the
 * `asserts` narrowing signature.
 */
export function invariant(condition: boolean, message: string, reason?: string): asserts condition {
  if (!condition) {
    throw new ValidationError(message, reason);
  }
}

/**
 * Invariant/guard helpers used inside the domain layer to keep aggregates valid.
 * Failures throw a ValidationError (domain error), never a framework exception.
 */
export const Guard = {
  /** Throws ValidationError(message) when `condition` is false. */
  invariant(condition: boolean, message: string, reason?: string): void {
    invariant(condition, message, reason);
  },

  againstNullOrUndefined(value: unknown, name: string): void {
    if (value === null || value === undefined) {
      throw new ValidationError(`${name} is required`, `${name}_required`);
    }
  },

  againstEmpty(value: string | null | undefined, name: string): void {
    if (value === null || value === undefined || value.trim().length === 0) {
      throw new ValidationError(`${name} must not be empty`, `${name}_empty`);
    }
  },

  inRange(value: number, min: number, max: number, name: string): void {
    if (value < min || value > max) {
      throw new ValidationError(
        `${name} must be between ${String(min)} and ${String(max)}`,
        `${name}_out_of_range`,
      );
    }
  },

  oneOf<T>(value: T, allowed: readonly T[], name: string): void {
    if (!allowed.includes(value)) {
      throw new ValidationError(
        `${name} must be one of: ${allowed.map((v) => String(v)).join(', ')}`,
        `${name}_invalid`,
      );
    }
  },
} as const;
