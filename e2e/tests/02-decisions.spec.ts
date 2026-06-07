import { test, expect } from '../src/fixtures/app.fixture';
import { EXPENSES } from '../src/constants';

/**
 * DECISION flows as Riya (finance_manager). The PEP -> Cerbos PDP is the real
 * gate; the UI only reflects the 200 ALLOW or the 403 DENY envelope. Each test
 * asserts BOTH the visible UI block AND the captured server response.
 */
test.describe('DECISIONS (as Riya, finance_manager)', () => {
  test('approve exp_42 ($8,500 same-dept Acme) -> ALLOW (200) shown with decisionId', async ({
    loginAs,
  }) => {
    const { expensesPage } = await loginAs('riya');

    const res = await expensesPage.approve(EXPENSES.allow, 200);
    const body = (await res.json()) as { decisionId?: string; status?: string };
    expect(body.decisionId).toBeTruthy();

    // Visible UI: the ALLOW block with the same decisionId the server returned.
    const decisionText = await expensesPage.expectAllowed(EXPENSES.allow);
    expect(decisionText).toContain(body.decisionId ?? '__missing__');
  });

  test('approve exp_99 ($25,000) -> DENY (403) by the ABAC amount<10000 rule', async ({
    loginAs,
  }) => {
    const { expensesPage } = await loginAs('riya');

    // exp_99 is $25,000: the finance_manager rule's `amount < 10000` predicate
    // fails, so the PDP denies (403). Cerbos reports the deciding policy as the
    // reason ("denied by expense_report/acme.finance"), not the raw predicate.
    const res = await expensesPage.approve(EXPENSES.abacDeny, 403);
    const body = (await res.json()) as { error?: { code?: string; reason?: string; message?: string } };
    expect(body.error?.code).toBe('forbidden');
    const serverReason = (body.error?.reason ?? body.error?.message ?? '').toLowerCase();

    // Visible UI: the DENY block; its reason is the PDP's deciding-policy reason.
    const uiReason = (await expensesPage.expectDenied(EXPENSES.abacDeny)).toLowerCase();
    expect(`${uiReason} ${serverReason}`).toMatch(/denied by|expense_report|deny/);
  });

  test('approve a Globex expense -> DENIED by the tenant guardrail (cross-tenant: RLS-invisible)', async ({
    loginAs,
  }) => {
    const { expensesPage } = await loginAs('riya');

    // exp_glx belongs to Globex. An Acme principal's request runs inside the
    // Acme-bound RLS transaction, so the Globex row is INVISIBLE — the PEP loads
    // null and fails closed with 404 "Resource not found" (the tenant-guardrail
    // outcome: a cross-tenant resource is never reachable, never an ABAC decision).
    const res = await expensesPage.approve(EXPENSES.crossTenant, 404);
    const body = (await res.json()) as { error?: { code?: string; reason?: string; message?: string } };
    const serverText = `${body.error?.code ?? ''} ${body.error?.reason ?? ''} ${body.error?.message ?? ''}`.toLowerCase();

    // Visible UI: the DENY block; its reason is the cross-tenant outcome.
    const uiReason = (await expensesPage.expectDenied(EXPENSES.crossTenant)).toLowerCase();
    // Cross-tenant guardrail: must be a tenant/not-found outcome — NEVER an ABAC
    // amount failure (which would mean a Globex row leaked into Acme's policy eval).
    expect(`${uiReason} ${serverText}`).toMatch(/tenant|guardrail|not found|not_found/);
    expect(`${uiReason} ${serverText}`).not.toMatch(/amount/);
  });
});
