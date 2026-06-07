import { makeCursorPage } from '@kernel/core';
import {
  type EffectivePrincipal,
  type PdpCheckResult,
} from '@contracts/core';
import { type AuditSink, type CerbosPdpClient, type PipClient } from '@authz/pep';

import { ListAuthorizedExpensesUseCase } from '../application/use-cases/list-authorized-expenses.use-case';
import { Expense } from '../domain/expense.entity';
import { type ExpenseRepository } from '../domain/expense.repository.port';

/**
 * Unit test for the authorization-aware list (DESIGN §8.2). The repository, PDP,
 * PIP and AuditSink are all mocked: the candidate set comes back from the
 * (RLS-scoped) repository, and the use-case must return ONLY the expenses the PDP
 * ALLOWs `read` on, auditing every decision (allow AND deny).
 */
describe('ListAuthorizedExpensesUseCase (mocked PDP+PIP)', () => {
  const ACME = 'aaaaaaaa-0000-4000-8000-000000000001';
  const created = new Date('2026-06-01T00:00:00.000Z');

  function expense(id: string, amount: number): Expense {
    return Expense.create({
      id,
      tenantId: ACME,
      amount,
      currency: 'USD',
      department: 'finance',
      ownerId: 'riya',
      description: id,
      scope: 'acme.finance',
      now: created,
    });
  }

  const effective: EffectivePrincipal = {
    id: 'riya',
    tenantId: ACME,
    roles: ['finance_manager'],
    attr: { tenantId: ACME, department: 'finance' },
  };

  const query = {
    principalId: 'riya',
    tenantId: ACME,
    actorId: 'riya',
    traceId: 'trc_list',
  };

  function build(opts: {
    items: Expense[];
    decide: (resourceId: string) => 'ALLOW' | 'DENY';
  }): {
    useCase: ListAuthorizedExpensesUseCase;
    auditRecord: jest.Mock;
    pipResolve: jest.Mock;
  } {
    const repo: ExpenseRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      list: jest.fn().mockResolvedValue(makeCursorPage(opts.items, null)),
    };
    const pdpCheck = jest.fn(
      (
        _p: unknown,
        resource: { id: string },
        actions: string[],
      ): Promise<PdpCheckResult> =>
        Promise.resolve({
          decisionId: `dec_${resource.id}`,
          results: actions.map((action) => ({ action, effect: opts.decide(resource.id) })),
        }),
    );
    const pdp = { check: pdpCheck } as unknown as CerbosPdpClient;
    const pipResolve = jest.fn().mockResolvedValue(effective);
    const pip = { resolve: pipResolve } as unknown as PipClient;
    const auditRecord = jest.fn();
    const audit = { record: auditRecord } as unknown as AuditSink;

    return {
      useCase: new ListAuthorizedExpensesUseCase(repo, pdp, pip, audit),
      auditRecord,
      pipResolve,
    };
  }

  it('returns only the expenses the PDP ALLOWs read on, and audits every decision', async () => {
    const items = [expense('exp_42', 8500), expense('exp_99', 25000)];
    // Allow exp_42, deny exp_99 (e.g. amount-based ABAC).
    const { useCase, auditRecord } = build({
      items,
      decide: (id) => (id === 'exp_42' ? 'ALLOW' : 'DENY'),
    });

    const page = await useCase.execute(query);

    expect(page.items.map((e) => e.id)).toEqual(['exp_42']);
    expect(page.nextCursor).toBeNull();
    // Both decisions audited (one allow, one deny).
    expect(auditRecord).toHaveBeenCalledTimes(2);
    const effects = auditRecord.mock.calls.map((c) => (c[0] as { effect: string }).effect).sort();
    expect(effects).toEqual(['ALLOW', 'DENY']);
  });

  it('resolves the per-scope effective principal ONCE for a same-scope page (PIP not stampeded)', async () => {
    const items = [expense('exp_42', 8500), expense('exp_99', 9000)];
    const { useCase, pipResolve } = build({ items, decide: () => 'ALLOW' });

    const page = await useCase.execute(query);

    expect(page.items).toHaveLength(2);
    // Both expenses share scope acme.finance -> a single PIP resolve.
    expect(pipResolve).toHaveBeenCalledTimes(1);
    expect(pipResolve).toHaveBeenCalledWith('riya', ACME, 'acme.finance', false);
  });

  it('returns an empty page when the principal may read nothing', async () => {
    const items = [expense('exp_42', 8500)];
    const { useCase } = build({ items, decide: () => 'DENY' });

    const page = await useCase.execute(query);
    expect(page.items).toEqual([]);
  });
});
