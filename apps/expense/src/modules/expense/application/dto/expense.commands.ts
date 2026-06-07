/**
 * Application-layer command/query inputs. Plain data shapes (no framework
 * decorators) handed from the controller to the use-cases. HTTP-facing validation
 * lives on the presentation request DTOs; PEP authorization runs in the guard.
 */

/**
 * Input to the approve use-case. The PEP has ALREADY authorized the action in the
 * guard; `approvedBy` and `decisionId` come from the verified identity context and
 * the allowing PDP decision the guard exposed (DESIGN §8.2), never from the body.
 */
export interface ApproveExpenseCommand {
  expenseId: string;
  approvedBy: string;
  decisionId: string;
}

/**
 * Input to the authorization-aware list use-case. The principal/tenant come from
 * the verified identity context; the use-case filters to the expenses the
 * principal may `read` via the PDP (DESIGN §8.2).
 */
export interface ListAuthorizedExpensesQuery {
  principalId: string;
  tenantId: string;
  actorId: string;
  traceId: string;
  limit?: number;
  cursor?: string | null;
}
