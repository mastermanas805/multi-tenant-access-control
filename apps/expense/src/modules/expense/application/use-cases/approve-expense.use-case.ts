import { Inject, Injectable } from '@nestjs/common';

import { type ApproveExpenseResponse } from '@contracts/core';
import {
  type Clock,
  CLOCK,
  type IDomainEventDispatcher,
  DOMAIN_EVENT_DISPATCHER,
} from '@kernel/core';

import { ExpenseNotFoundError } from '../../domain/expense.errors';
import { type ExpenseRepository, EXPENSE_REPOSITORY } from '../../domain/expense.repository.port';
import { ExpenseId } from '../../domain/value-objects/expense-id.vo';
import { type ApproveExpenseCommand } from '../dto/expense.commands';

/**
 * Approves an expense AFTER the PEP has authorized the `approve` action
 * (DESIGN §4.3). The guard ran the tenant guardrail, resolved the principal via
 * the PIP and called the PDP; on ALLOW it exposed the decisionId. This use-case
 * only performs the state transition:
 *   1. load the expense from the service's OWN db (RLS-scoped),
 *   2. apply the aggregate's `approve` invariant (rejects re-approval),
 *   3. persist (atomic optimistic CAS),
 *   4. dispatch the raised ExpenseApprovedEvent (DESIGN §3.4),
 *   5. return the §8.2 approve response echoing the decisionId.
 *
 * Depends only on the repository PORT, the Clock and the domain-event dispatcher
 * ports — no TypeORM, no HTTP, no Cerbos.
 */
@Injectable()
export class ApproveExpenseUseCase {
  constructor(
    @Inject(EXPENSE_REPOSITORY) private readonly expenses: ExpenseRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DOMAIN_EVENT_DISPATCHER) private readonly events: IDomainEventDispatcher,
  ) {}

  public async execute(command: ApproveExpenseCommand): Promise<ApproveExpenseResponse> {
    const id = ExpenseId.fromString(command.expenseId);
    const expense = await this.expenses.findById(id);
    if (!expense) {
      throw new ExpenseNotFoundError(command.expenseId);
    }

    const now = this.clock.now();
    expense.approve(command.approvedBy, command.decisionId, now);
    await this.expenses.save(expense);
    await this.events.dispatch(expense.pullDomainEvents());

    return {
      id: expense.id.toString(),
      status: expense.status,
      approvedBy: command.approvedBy,
      decisionId: command.decisionId,
      at: now.toISOString(),
    };
  }
}
