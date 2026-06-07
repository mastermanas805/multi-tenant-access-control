import { expect, type Page } from '@playwright/test';

import { FINANCE_MANAGER_ROLE_ID } from '../constants';

/**
 * Screen 3 — Admin (org_admin only). Lists Riya's role assignments and lets the
 * admin REVOKE / GRANT finance_manager through the gateway (PAP). Drives FR-8.
 *
 * NOTE: when finance_manager is re-granted, the PAP mints a NEW assignment row
 * with a NEW UUID, so the revoke button's testid is dynamic. This page object
 * never hardcodes the assignment id — it discovers the active row from the DOM.
 */
export class AdminPage {
  constructor(private readonly page: Page) {}

  async waitReady(): Promise<void> {
    await expect(this.page.getByTestId('admin-screen')).toBeVisible();
    await expect(this.page.getByTestId('admin-banner')).toBeVisible();
    await expect(this.page.getByTestId('admin-assignments-table')).toBeVisible();
    // The table SHELL renders before the async assignments fetch resolves, so a
    // caller could observe a transient empty table. Riya always has at least one
    // finance assignment (seed/grant), so wait until a real row has loaded —
    // never read grant state off an un-populated table.
    await expect(
      this.page.locator('[data-testid^="assignment-row-"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  }

  /** The currently-visible Revoke button (only rendered on the active finance row). */
  private revokeButton(): import('@playwright/test').Locator {
    return this.page.locator('[data-testid^="revoke-btn-"]');
  }

  /** True if Riya currently has an active finance_manager grant (Revoke shown). */
  async hasActiveFinanceGrant(): Promise<boolean> {
    return (await this.revokeButton().count()) > 0;
  }

  /**
   * Revoke Riya's active finance_manager grant. Waits for the PAP revoke call to
   * return 2xx, then for the row status to flip to `revoked` and the grant button
   * to become enabled. Returns the captured revoke Response.
   */
  async revokeFinanceManager(): Promise<import('@playwright/test').Response> {
    await expect(this.revokeButton()).toBeVisible();
    const testid = await this.revokeButton().getAttribute('data-testid');
    const asgId = (testid ?? '').replace('revoke-btn-', '');
    expect(asgId).not.toEqual('');

    const revokeResp = this.page.waitForResponse(
      (r) =>
        r.url().includes(`/v1/role-assignments/${asgId}/revoke`) &&
        r.request().method() === 'POST',
    );
    await this.revokeButton().click();
    const res = await revokeResp;
    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);

    // The row's status cell flips to `revoked`; the Grant button re-enables.
    await expect(this.page.getByTestId(`assignment-status-${asgId}`)).toHaveText('revoked');
    await expect(this.page.getByTestId('grant-finance-manager-btn')).toBeEnabled();
    await expect(this.page.getByTestId('admin-notice')).toContainText(/Revoked/i);
    return res;
  }

  /**
   * Grant finance_manager back to Riya. Waits for the PAP create call to return
   * 2xx, then for a fresh ACTIVE row (Revoke button) to appear. Returns the
   * captured grant Response.
   */
  async grantFinanceManager(): Promise<import('@playwright/test').Response> {
    const grantBtn = this.page.getByTestId('grant-finance-manager-btn');
    await expect(grantBtn).toBeEnabled();

    const grantResp = this.page.waitForResponse(
      (r) =>
        r.url().endsWith('/v1/role-assignments') && r.request().method() === 'POST',
    );
    await grantBtn.click();
    const res = await grantResp;
    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);

    // A fresh active finance_manager assignment appears (Revoke button returns).
    await expect(this.revokeButton()).toBeVisible({ timeout: 15_000 });
    await expect(this.page.getByTestId('admin-notice')).toContainText(/Granted/i);
    return res;
  }

  /** Assert at least one row references the finance_manager role id. */
  async expectFinanceManagerRowPresent(): Promise<void> {
    await expect(
      this.page.getByTestId('admin-assignments-table'),
    ).toContainText(FINANCE_MANAGER_ROLE_ID);
  }
}
