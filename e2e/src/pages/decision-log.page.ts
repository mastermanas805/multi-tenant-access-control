import { expect, type Page } from '@playwright/test';

/**
 * Screen 4 — Decision-log panel. Reads the tamper-evident audit log THROUGH the
 * gateway (/v1/audit/events) and shows each decision's effect + reason +
 * decisionId. Used to prove allow/deny decisions were actually recorded server-side.
 */
export class DecisionLogPage {
  constructor(private readonly page: Page) {}

  async waitReady(): Promise<void> {
    await expect(this.page.getByTestId('decision-log-panel')).toBeVisible();
    await expect(this.page.getByTestId('decision-log-table')).toBeVisible();
  }

  /** Click Refresh and wait for the underlying audit read to complete. */
  async refresh(): Promise<void> {
    const auditResp = this.page.waitForResponse(
      (r) => r.url().includes('/v1/audit/events') && r.request().method() === 'GET',
    );
    await this.page.getByTestId('decision-log-refresh').click();
    await auditResp;
  }

  /** All effect badges currently rendered (ALLOW / DENY / N/A), top-to-bottom. */
  async effects(): Promise<string[]> {
    const cells = this.page.locator('[data-testid^="decision-effect-"]');
    return cells.allInnerTexts();
  }

  /** Assert the decision-log table currently contains the given text (e.g. a decisionId). */
  async expectTableContains(text: string): Promise<void> {
    await expect(this.page.getByTestId('decision-log-table')).toContainText(text);
  }

  /**
   * Wait until the log contains at least one row with the given effect, returning
   * that row's `{ reason, decisionId }`. Retries via the Refresh button because
   * audit ingestion is asynchronous to the approve response.
   */
  async waitForEffect(effect: 'ALLOW' | 'DENY'): Promise<{ reason: string; decisionId: string }> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const badge = this.page
        .locator(`[data-testid^="decision-effect-"]`, { hasText: new RegExp(`^${effect}$`) })
        .first();
      if ((await badge.count()) > 0) {
        const testid = await badge.getAttribute('data-testid');
        const seq = (testid ?? '').replace('decision-effect-', '');
        const reason = (await this.page.getByTestId(`decision-reason-${seq}`).innerText()).trim();
        const decisionId = (await this.page.getByTestId(`decision-id-${seq}`).innerText()).trim();
        return { reason, decisionId };
      }
      await this.refresh();
    }
    throw new Error(`decision-log never showed a ${effect} entry`);
  }
}
