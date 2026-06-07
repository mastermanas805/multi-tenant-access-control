import { ConflictError, NotFoundError } from '@kernel/core';

/** The requested expense does not exist (or is invisible under RLS). -> 404 */
export class ExpenseNotFoundError extends NotFoundError {
  constructor(expenseId: string) {
    super(`Expense ${expenseId} not found`, 'expense_not_found');
  }
}

/**
 * An operation is invalid for the expense's current status (e.g. approving an
 * already-approved or rejected report). -> 409
 * Inherits ConflictError's (message, reason?) constructor; callers always pass a
 * reason so the §8.1 envelope carries it.
 */
export class ExpenseStatusError extends ConflictError {}
