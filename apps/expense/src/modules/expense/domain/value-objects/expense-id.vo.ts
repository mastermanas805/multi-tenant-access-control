import { ValidationError } from '@kernel/core';

/**
 * Strongly-typed Expense identity. An expense id is a HUMAN-READABLE business id
 * (e.g. `exp_42`), NOT a UUID — so it is validated as a non-empty, bounded,
 * URL-safe token rather than via the UUID check used for tenant/aggregate ids.
 * Wrapping it prevents confusing an ExpenseId with any other id at compile time.
 */
export class ExpenseId {
  private static readonly PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Rehydrates/creates an ExpenseId from a string; validates the format. */
  public static fromString(value: string): ExpenseId {
    if (!ExpenseId.PATTERN.test(value)) {
      throw new ValidationError('Invalid expense id', 'expense_id_invalid');
    }
    return new ExpenseId(value);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other?: ExpenseId): boolean {
    return this.value === other?.value;
  }
}
