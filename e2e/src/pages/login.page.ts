import { expect, type Page, type Response } from '@playwright/test';

import { ROLE_LABEL, WEB_URL, type UserKey } from '../constants';

/**
 * Screen 1 — Login / user switch. Each "login-as-*" button calls the gateway
 * POST /v1/auth/token and, on success, the shell renders `app-authenticated`.
 */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
    await expect(this.page.getByTestId('login-screen')).toBeVisible();
  }

  /** Assert the three seeded users + their role labels are rendered. */
  async expectSeededUsers(): Promise<void> {
    for (const key of ['riya', 'sam', 'dev'] as const) {
      await expect(this.page.getByTestId(`login-as-${key}`)).toBeVisible();
      await expect(this.page.getByTestId(`login-role-${key}`)).toHaveText(ROLE_LABEL[key]);
    }
  }

  /**
   * Click a user, asserting the REAL token call to the gateway returned 200 AND
   * the authenticated shell appears. Returns the captured auth Response so a test
   * can assert it came from the server (status + JSON body shape).
   */
  async loginAs(user: UserKey): Promise<Response> {
    const tokenResponse = this.page.waitForResponse(
      (r) => r.url().includes('/v1/auth/token') && r.request().method() === 'POST',
    );
    await this.page.getByTestId(`login-as-${user}`).click();
    const res = await tokenResponse;
    await expect(this.page.getByTestId('app-authenticated')).toBeVisible();
    await expect(this.page.getByTestId('current-user')).toContainText(ROLE_LABEL[user]);
    return res;
  }

  /** Drive an intentionally-failing login (interception forces bad credentials). */
  async loginExpectingError(user: UserKey): Promise<void> {
    await this.page.getByTestId(`login-as-${user}`).click();
    await expect(this.page.getByTestId('login-error')).toBeVisible();
  }

  /**
   * "Switch user": click logout, then log in as another seeded user. The session
   * (and the in-memory JWT) is fully replaced, so the new user's token drives the
   * subsequent calls. Returns the new login's auth Response.
   */
  async switchTo(user: UserKey): Promise<Response> {
    await this.page.getByTestId('logout-btn').click();
    await expect(this.page.getByTestId('login-screen')).toBeVisible();
    return this.loginAs(user);
  }
}
