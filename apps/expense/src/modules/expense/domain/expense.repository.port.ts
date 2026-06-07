import { type CursorPage, type PageQuery } from '@kernel/core';

import { type Expense } from './expense.entity';
import { type ExpenseId } from './value-objects/expense-id.vo';

/**
 * Repository PORT for the Expense aggregate. The domain/application layers depend
 * ONLY on this interface; the TypeORM adapter in the infrastructure layer
 * implements it. This is the seam that keeps the dependency rule intact.
 */
export interface ExpenseRepository {
  /** Persists a new or updated aggregate (the adapter decides insert vs update). */
  save(expense: Expense): Promise<void>;

  /** Loads an expense by id, or null when absent (or invisible under RLS). */
  findById(id: ExpenseId): Promise<Expense | null>;

  /** Cursor-paginated list of the tenant's expenses (most-recent first, RLS-scoped). */
  list(query: PageQuery): Promise<CursorPage<Expense>>;
}

/**
 * DI token for the repository port. Use-cases inject this token (not the class)
 * so they remain framework- and persistence-agnostic.
 */
export const EXPENSE_REPOSITORY = Symbol('EXPENSE_REPOSITORY');
