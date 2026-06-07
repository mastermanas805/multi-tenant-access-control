import { test, expect } from '../src/fixtures/app.fixture';
import { EXPENSES } from '../src/constants';

/**
 * SECURITY UX — the §13 principle: hiding a button is UX, not the security gate.
 * For Sam (who will be denied) the Approve button is STILL rendered; clicking it
 * proves the server (PEP) is the gate by returning a real 403.
 */
test.describe('SECURITY UX (UI-hiding is not the gate)', () => {
  test('as Sam, the Approve button is visible and clicking it yields a server 403', async ({
    loginAs,
  }) => {
    const { expensesPage } = await loginAs('sam');

    // The button is rendered even though Sam cannot approve (no client-side hide).
    const btn = expensesPage.approveButton(EXPENSES.allow);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();

    // Clicking it hits the PEP, which returns 403 — the server is the gate.
    const res = await expensesPage.approve(EXPENSES.allow, 403);
    expect(res.status()).toBe(403);

    // Visible UI: the server's DENY block is shown (the click was NOT pre-blocked).
    await expensesPage.expectDenied(EXPENSES.allow);
  });
});
