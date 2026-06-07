import { type DecisionAuditRecord } from '@contracts/core';

import { commandFromDecisionRecord } from '../application/dto/audit-event.commands';

/**
 * Verifies the adapter from the SHARED PEP contract (`DecisionAuditRecord`,
 * @contracts/core) to the ingest command. This is the canonical path a service's
 * HttpAuditSink uses, so the field mapping must be exact.
 */
describe('commandFromDecisionRecord', () => {
  const record: DecisionAuditRecord = {
    decisionId: 'dec_1',
    traceId: 'trc_1',
    tenantId: 'aaaaaaaa-0000-4000-8000-000000000001',
    principalId: 'riya',
    actorId: 'riya',
    resourceKind: 'expense_report',
    resourceId: 'exp_1',
    action: 'approve',
    effect: 'ALLOW',
    policy: 'expense_report/acme.finance',
    reason: 'finance_manager same dept amount<10000',
    decidedAt: '2026-06-06T10:00:00.000Z',
  };

  it('maps every field of the shared contract onto the command', () => {
    const command = commandFromDecisionRecord(record);

    expect(command).toEqual({
      tenantId: 'aaaaaaaa-0000-4000-8000-000000000001',
      actor: 'riya',
      action: 'approve',
      decision: 'ALLOW',
      resourceKind: 'expense_report',
      resourceId: 'exp_1',
      reason: 'finance_manager same dept amount<10000',
      policy: 'expense_report/acme.finance',
      decisionId: 'dec_1',
      traceId: 'trc_1',
      occurredAt: '2026-06-06T10:00:00.000Z',
    });
  });

  it('normalizes absent optional policy/reason to null', () => {
    const minimal: DecisionAuditRecord = {
      decisionId: 'dec_2',
      traceId: 'trc_2',
      tenantId: 'aaaaaaaa-0000-4000-8000-000000000001',
      principalId: 'sam',
      actorId: 'sam',
      resourceKind: 'expense_report',
      resourceId: 'exp_2',
      action: 'approve',
      effect: 'DENY',
      decidedAt: '2026-06-06T10:01:00.000Z',
    };

    const command = commandFromDecisionRecord(minimal);

    expect(command.reason).toBeNull();
    expect(command.policy).toBeNull();
    expect(command.decision).toBe('DENY');
  });
});
