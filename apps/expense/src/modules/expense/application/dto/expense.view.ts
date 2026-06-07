import { type ExpenseDto } from '@contracts/core';

import { type Expense } from '../../domain/expense.entity';

/**
 * Read-model view of an Expense returned by use-cases. Matches the shared
 * `@contracts/core` ExpenseDto wire contract so the service, demo UI and tests
 * agree (DESIGN §8.2).
 */
export type ExpenseView = ExpenseDto;

/** Maps an Expense aggregate to its view representation (the wire DTO). */
export function toExpenseView(expense: Expense): ExpenseView {
  return {
    id: expense.id.toString(),
    tenantId: expense.tenantId,
    amount: expense.amount,
    currency: expense.currency,
    department: expense.department,
    ownerId: expense.ownerId,
    status: expense.status,
    description: expense.description,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

/** A page of expense views (cursor pagination — mirrors the kernel CursorPage). */
export interface ExpensePageView {
  items: ExpenseView[];
  nextCursor: string | null;
}
