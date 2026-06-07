/**
 * Expense domain DTOs/types (DESIGN §8.2, §13). The Expense service is the worked
 * PEP example: `POST /expenses/:id/approve` runs the guard → Cerbos. These shapes
 * are shared so the service, the demo UI, and tests agree on the wire contract.
 */

/** Lifecycle of an expense report. */
export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

/** The Cerbos resource kind for an expense report (DESIGN §3.1). */
export const EXPENSE_RESOURCE_KIND = 'expense_report';

/** Actions on an expense report (the policy `actions` namespace). */
export type ExpenseAction = 'read' | 'approve' | 'reject' | 'delete' | 'create';

/**
 * The expense resource as returned to clients. `tenantId`, `amount`, `department`
 * and `ownerId` are the ATTRIBUTES the PEP loads in-request and feeds to the PDP
 * (DESIGN §3.5 — resource attrs are always fresh, never cached).
 */
export interface ExpenseDto {
  readonly id: string;
  readonly tenantId: string;
  readonly amount: number;
  readonly currency: string;
  readonly department: string;
  /** The principal id that created/owns the expense (for ownership/SoD rules, DESIGN §3, App. A). */
  readonly ownerId: string;
  readonly status: ExpenseStatus;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Body for `POST /expenses` (create). */
export interface CreateExpenseRequest {
  readonly amount: number;
  readonly currency: string;
  readonly department: string;
  readonly description: string;
}

/** Body for `POST /expenses/:id/approve`. */
export interface ApproveExpenseRequest {
  readonly comment?: string;
}

/**
 * `200` response from a successful approve (DESIGN §8.2). Carries the
 * `decisionId` so the client/audit can correlate the allowing decision.
 */
export interface ApproveExpenseResponse {
  readonly id: string;
  readonly status: ExpenseStatus;
  readonly approvedBy: string;
  readonly decisionId: string;
  readonly at: string;
}

/** A page of expenses (cursor pagination, DESIGN §8.2). */
export interface ExpensePage {
  readonly items: ExpenseDto[];
  readonly nextCursor: string | null;
}
