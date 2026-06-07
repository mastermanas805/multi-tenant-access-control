import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Screen 2 — Expenses. Every row carries an Approve button (even for users who
 * will be denied — UI hiding is UX, not security). On click the PEP returns 200
 * (ALLOW block) or 403 (DENY envelope with reason + decisionId).
 */
export class ExpensesPage {
  constructor(private readonly page: Page) {}

  async waitReady(): Promise<void> {
    await expect(this.page.getByTestId('expenses-screen')).toBeVisible();
    await expect(this.page.getByTestId('expenses-table')).toBeVisible();
  }

  approveButton(id: string): Locator {
    return this.page.getByTestId(`approve-btn-${id}`);
  }

  /**
   * Click Approve for `id` and assert the REAL approve call to the gateway
   * completed with `expectedStatus`. Returns the captured Response so the caller
   * can assert the server body (decisionId / reason) in addition to the UI.
   */
  async approve(id: string, expectedStatus: number): Promise<import('@playwright/test').Response> {
    return this.approveExpectingStatus(id, [expectedStatus]);
  }

  /**
   * Click Approve and assert the captured response status is one of `allowed`.
   *
   * Authorization vs state transition: the PEP authorizes the `approve` action
   * (200/403/404) and only THEN does the use-case run the pending->approved state
   * change. Re-approving an already-approved expense is a 409 Conflict — but the
   * request still PASSED the PDP (the authz decision was ALLOW; the audit ALLOW is
   * recorded). So "authorized" == status in {200, 409}; "denied" == 403/404. This
   * lets state-coupled flows (a demo expense approved by an earlier test) still
   * assert the authorization outcome they care about.
   */
  async approveExpectingStatus(
    id: string,
    allowed: number[],
  ): Promise<import('@playwright/test').Response> {
    const approveResponse = this.page.waitForResponse(
      (r) =>
        r.url().includes(`/v1/expenses/${id}/approve`) && r.request().method() === 'POST',
    );
    await this.approveButton(id).click();
    const res = await approveResponse;
    expect(
      allowed,
      `approve(${id}) returned ${String(res.status())}, expected one of ${allowed.join(', ')}`,
    ).toContain(res.status());
    return res;
  }

  /** Authorized == the request got PAST the PDP (200 ALLOW, or 409 already-approved). */
  async approveAuthorized(id: string): Promise<import('@playwright/test').Response> {
    return this.approveExpectingStatus(id, [200, 409]);
  }

  /** Assert the ALLOW (200) block is visible with a non-empty decisionId. */
  async expectAllowed(id: string): Promise<string> {
    await expect(this.page.getByTestId(`approve-success-${id}`)).toBeVisible();
    const decisionText = await this.page.getByTestId(`approve-decision-${id}`).innerText();
    expect(decisionText).toMatch(/decisionId:\s*\S+/);
    return decisionText;
  }

  /** Assert the DENY (403) block is visible and return its rendered reason text. */
  async expectDenied(id: string): Promise<string> {
    await expect(this.page.getByTestId(`approve-denied-${id}`)).toBeVisible();
    return (await this.page.getByTestId(`approve-reason-${id}`).innerText()).trim();
  }

  /** Wait until the ALLOW block flips to a DENY block (or vice-versa) after a re-attempt. */
  async expectDeniedAppears(id: string): Promise<void> {
    await expect(this.page.getByTestId(`approve-denied-${id}`)).toBeVisible({ timeout: 15_000 });
  }

  async expectAllowedAppears(id: string): Promise<void> {
    await expect(this.page.getByTestId(`approve-success-${id}`)).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Assert the visible outcome reflects an AUTHORIZED approve given `status`:
   *   - 200 -> the ALLOW success block is shown;
   *   - 409 -> the deny block is shown but it is the already-approved CONFLICT
   *            (state), NOT an authorization denial ("denied by ..." / forbidden).
   * Either way the request was NOT blocked by the PDP.
   */
  async expectAuthorizedOutcome(id: string, status: number): Promise<void> {
    if (status === 200) {
      await this.expectAllowedAppears(id);
      return;
    }
    // 409: rendered as a deny block, but the reason is the conflict, not a 403.
    await this.expectDeniedAppears(id);
    const reason = (await this.page.getByTestId(`approve-reason-${id}`).innerText()).toLowerCase();
    expect(reason).toContain('already');
    expect(reason).not.toContain('denied by');
  }
}
