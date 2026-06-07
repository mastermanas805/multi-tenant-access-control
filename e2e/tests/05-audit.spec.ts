import { test, expect } from '../src/fixtures/app.fixture';
import { EXPENSES } from '../src/constants';

/**
 * AUDIT — every decision (allow AND deny) is recorded in the tamper-evident log.
 * As Riya, exercise an authorized approve (exp_42) and a denied approve (exp_99),
 * then assert the decision-log panel (read THROUGH the gateway from the audit
 * service) shows both a real ALLOW and a real DENY entry, each with a reason and
 * a decisionId.
 *
 * Authorization vs state: the audit ALLOW is recorded by the PEP guard BEFORE the
 * state transition, so exp_42 contributes an ALLOW decision even if the use-case
 * then returns 409 (already approved by an earlier test). The DENY (exp_99, 403)
 * carries its decisionId in the §8.1 envelope, which we cross-check against the log.
 */
test.describe('AUDIT (decision log shows ALLOW + DENY)', () => {
  test('decision log shows an ALLOW and a DENY entry with reasons + decisionId', async ({
    loginAs,
  }) => {
    const { expensesPage, decisionLog } = await loginAs('riya');

    // An authorized approve (records an ALLOW decision server-side, regardless of
    // whether the state transition succeeds or 409s).
    await expensesPage.approveAuthorized(EXPENSES.allow);

    // A denied approve -> 403 DENY with a decisionId in the envelope.
    const denyRes = await expensesPage.approve(EXPENSES.abacDeny, 403);
    const denyBody = (await denyRes.json()) as { error?: { decisionId?: string } };
    await expensesPage.expectDenied(EXPENSES.abacDeny);

    // The decision-log panel reads from the audit service via the gateway.
    await decisionLog.waitReady();

    // A real ALLOW entry (recorded server-side) with a decisionId.
    const allow = await decisionLog.waitForEffect('ALLOW');
    expect(allow.decisionId).not.toEqual('');
    expect(allow.decisionId).not.toEqual('—');

    // A real DENY entry with a reason + decisionId.
    const deny = await decisionLog.waitForEffect('DENY');
    expect(deny.decisionId).not.toEqual('');
    expect(deny.decisionId).not.toEqual('—');
    expect(deny.reason.toLowerCase()).toMatch(/denied by|expense_report|deny|cannot|forbidden/);

    // The DENY decisionId from THIS run's 403 envelope is present in the rendered
    // log (proving the panel reflects server-recorded decisions, not client state).
    if (denyBody.error?.decisionId !== undefined) {
      await decisionLog.refresh();
      await decisionLog.expectTableContains(denyBody.error.decisionId);
    }

    // Both effects are represented in the log.
    const effects = await decisionLog.effects();
    expect(effects).toContain('ALLOW');
    expect(effects).toContain('DENY');
  });
});
