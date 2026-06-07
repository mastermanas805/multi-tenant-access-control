import { type Clock, type IDomainEventDispatcher } from '@kernel/core';

import { ApproveExpenseUseCase } from '../application/use-cases/approve-expense.use-case';
import { Expense, ExpenseStatus } from '../domain/expense.entity';
import { ExpenseNotFoundError } from '../domain/expense.errors';
import { ExpenseStatusError } from '../domain/expense.errors';
import { type ExpenseRepository } from '../domain/expense.repository.port';

/**
 * Unit test for the approve use-case. The repository PORT, CLOCK and
 * DOMAIN_EVENT_DISPATCHER ports are mocked, so this exercises pure application
 * logic with no NestJS, no DB and no PEP — the guard has already authorized.
 */
describe('ApproveExpenseUseCase', () => {
  const fixedNow = new Date('2026-06-07T10:00:00.000Z');
  const clock: Clock = { now: () => fixedNow };
  const decisionId = 'dec_test_123';

  function makePending(): Expense {
    return Expense.create({
      id: 'exp_42',
      tenantId: 'aaaaaaaa-0000-4000-8000-000000000001',
      amount: 8500,
      currency: 'USD',
      department: 'finance',
      ownerId: 'riya',
      description: 'dinner',
      scope: 'acme.finance',
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
  }

  function makeRepo(expense: Expense | null): ExpenseRepository {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(expense),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
  }

  function makeDispatcher(): IDomainEventDispatcher {
    return { dispatch: jest.fn().mockResolvedValue(undefined) };
  }

  it('approves a pending expense, persists it and returns the §8.2 response with the decisionId', async () => {
    const expense = makePending();
    const repo = makeRepo(expense);
    const dispatcher = makeDispatcher();
    const useCase = new ApproveExpenseUseCase(repo, clock, dispatcher);

    const res = await useCase.execute({ expenseId: 'exp_42', approvedBy: 'riya', decisionId });

    expect(res.id).toBe('exp_42');
    expect(res.status).toBe('approved');
    expect(res.approvedBy).toBe('riya');
    expect(res.decisionId).toBe(decisionId);
    expect(res.at).toBe(fixedNow.toISOString());
    expect(expense.status).toBe(ExpenseStatus.Approved);
    expect(repo.save).toHaveBeenCalledTimes(1);
    // The approved event was raised and dispatched (and cleared from the aggregate).
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const dispatched = (dispatcher.dispatch as jest.Mock).mock.calls[0][0] as readonly {
      eventName(): string;
    }[];
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].eventName()).toBe('expense.approved');
  });

  it('raises ExpenseNotFoundError (-> 404) when the expense does not exist', async () => {
    const repo = makeRepo(null);
    const useCase = new ApproveExpenseUseCase(repo, clock, makeDispatcher());

    await expect(
      useCase.execute({ expenseId: 'exp_missing', approvedBy: 'riya', decisionId }),
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects re-approving an already-approved expense (-> 409) without persisting', async () => {
    const expense = makePending();
    expense.approve('riya', 'dec_prev', fixedNow);
    const repo = makeRepo(expense);
    (repo.save as jest.Mock).mockClear();
    const useCase = new ApproveExpenseUseCase(repo, clock, makeDispatcher());

    await expect(
      useCase.execute({ expenseId: 'exp_42', approvedBy: 'riya', decisionId }),
    ).rejects.toBeInstanceOf(ExpenseStatusError);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
