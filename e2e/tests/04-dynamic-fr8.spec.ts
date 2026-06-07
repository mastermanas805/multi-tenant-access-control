import { test, expect } from '../src/fixtures/app.fixture';
import { EXPENSES } from '../src/constants';

/**
 * DYNAMIC policy change (FR-8) — no redeploy. As Dev (org_admin), revoke Riya's
 * finance_manager through the gateway (PAP). Switch to Riya: her exp_42 approve
 * flips to DENIED (403) — the approve path re-resolves the principal FRESH
 * (sensitive: true), so the change takes effect immediately. Re-grant and the
 * approve is AUTHORIZED again (no longer 403).
 *
 * Authorization vs state: the PDP decision (403 deny vs allow) is what flips, and
 * it is enforced in the guard BEFORE the pending->approved state transition. So
 * the flip is observable regardless of exp_42's stored status — when re-granted,
 * the approve gets PAST the PDP (200 if still pending, or 409 already-approved by
 * an earlier test), never 403. The 403 -> not-403 contrast IS the live flip.
 *
 * Mutates shared server state; the suite is single-worker, and this test restores
 * the active grant before finishing.
 */
test.describe('DYNAMIC (FR-8 live policy flip)', () => {
  test('revoke -> Riya DENIED (403); re-grant -> Riya AUTHORIZED again (no redeploy)', async ({
    loginPage,
    expensesPage,
    adminPage,
  }) => {
    // Pre-condition: Riya currently HAS an active finance grant, so exp_42 is
    // authorized for her (proven by the DECISIONS suite). Confirm via Dev.
    await loginPage.goto();
    await loginPage.loginAs('dev');
    await adminPage.waitReady();
    expect(await adminPage.hasActiveFinanceGrant()).toBe(true);

    // REVOKE Riya's finance_manager through the gateway/PAP.
    await adminPage.revokeFinanceManager();

    // Switch to Riya: her exp_42 approve now flips to DENIED (live, no redeploy).
    // The guard denies BEFORE the use-case, so this is a clean 403 regardless of
    // exp_42's stored status.
    await loginPage.switchTo('riya');
    await expensesPage.waitReady();
    const denyRes = await expensesPage.approve(EXPENSES.allow, 403);
    expect(denyRes.status()).toBe(403);
    const denyBody = (await denyRes.json()) as { error?: { code?: string } };
    expect(denyBody.error?.code).toBe('forbidden');
    await expensesPage.expectDeniedAppears(EXPENSES.allow);
    const reason = (await expensesPage.expectDenied(EXPENSES.allow)).toLowerCase();
    expect(reason).toMatch(/denied by|expense_report|deny|forbidden|no rule/);

    // Switch back to Dev and RE-GRANT finance_manager.
    await loginPage.switchTo('dev');
    await adminPage.waitReady();
    await adminPage.grantFinanceManager();

    // Switch to Riya: the approve is AUTHORIZED again (no longer 403). It gets
    // PAST the PDP — 200 (ALLOW) or 409 (already-approved by an earlier test).
    await loginPage.switchTo('riya');
    await expensesPage.waitReady();
    const allowRes = await expensesPage.approveAuthorized(EXPENSES.allow);
    expect(allowRes.status()).not.toBe(403);
    await expensesPage.expectAuthorizedOutcome(EXPENSES.allow, allowRes.status());

    // Leave the demo grant active for the rest of the suite (defensive).
    await loginPage.switchTo('dev');
    await adminPage.waitReady();
    expect(await adminPage.hasActiveFinanceGrant()).toBe(true);
  });
});
