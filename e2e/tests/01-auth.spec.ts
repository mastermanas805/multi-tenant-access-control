import { test, expect } from '../src/fixtures/app.fixture';
import { ROLE_LABEL } from '../src/constants';

/**
 * AUTH flows — login as each seeded user succeeds (real RS256 token from the
 * gateway -> identity), and invalid credentials surface a visible error.
 */
test.describe('AUTH', () => {
  test('login screen renders the three seeded users with their roles', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.expectSeededUsers();
  });

  for (const user of ['riya', 'sam', 'dev'] as const) {
    test(`login as ${user} succeeds (gateway POST /v1/auth/token -> 200)`, async ({
      page,
      loginPage,
    }) => {
      await loginPage.goto();
      const res = await loginPage.loginAs(user);

      // Came from the server: the token call returned 200 with a real JWT body.
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { accessToken?: string; tid?: string; sub?: string };
      expect(typeof body.accessToken).toBe('string');
      expect((body.accessToken ?? '').split('.')).toHaveLength(3); // header.payload.signature
      expect(body.tid).toBeTruthy();
      expect(body.sub).toBeTruthy();

      // Visible UI result: the authenticated shell + the user's role label.
      await expect(page.getByTestId('current-user')).toContainText(ROLE_LABEL[user]);
    });
  }

  test('invalid credentials show a login error (server 401, no session)', async ({
    page,
    loginPage,
  }) => {
    // Force a bad-credential login by rewriting the password in the token request
    // body. The gateway/identity is still the gate — it returns 401 and the UI
    // renders the §8.1 error envelope in `login-error`.
    await page.route('**/v1/auth/token', async (route) => {
      const original = route.request().postDataJSON() as { email: string; password: string };
      await route.continue({
        postData: JSON.stringify({ email: original.email, password: 'WRONG-password' }),
      });
    });

    const authResp = page.waitForResponse(
      (r) => r.url().includes('/v1/auth/token') && r.request().method() === 'POST',
    );
    await loginPage.goto();
    await page.getByTestId('login-as-riya').click();
    const res = await authResp;

    // Came from the server: a 4xx (401) auth failure, not a client-side block.
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);

    // Visible UI result: the error message is shown and we are NOT authenticated.
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('app-authenticated')).toHaveCount(0);
    await expect(page.getByTestId('login-screen')).toBeVisible();
  });
});
