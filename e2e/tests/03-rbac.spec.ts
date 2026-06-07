import { test, expect } from '../src/fixtures/app.fixture';
import { EXPENSES } from '../src/constants';

/**
 * RBAC — Sam is an engineer with NO finance grant. No ALLOW rule matches, so the
 * PDP denies his approve with a 403. (Same Acme tenant, so the resource is
 * visible — this is a pure role/policy denial, not a tenant/visibility one.)
 */
test.describe('RBAC (as Sam, engineer)', () => {
  test('approve exp_42 -> DENIED (403, no rule grants it)', async ({ loginAs }) => {
    const { expensesPage } = await loginAs('sam');

    // Sam has no finance grant, so NO ALLOW rule matches -> the PDP denies (403),
    // BEFORE the state transition runs (so this is a pure authz denial regardless
    // of exp_42's current status). Cerbos reports the deciding policy as the reason.
    const res = await expensesPage.approve(EXPENSES.allow, 403);
    const body = (await res.json()) as { error?: { code?: string; reason?: string } };
    expect(body.error?.code).toBe('forbidden');

    // Visible UI: the DENY block with the PDP's deciding-policy reason.
    const uiReason = (await expensesPage.expectDenied(EXPENSES.allow)).toLowerCase();
    const serverReason = (body.error?.reason ?? '').toLowerCase();
    expect(`${uiReason} ${serverReason}`).toMatch(/denied by|expense_report|deny|forbidden|no rule/);
  });
});
