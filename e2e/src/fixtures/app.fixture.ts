import { test as base } from '@playwright/test';

import { type UserKey } from '../constants';
import { AdminPage } from '../pages/admin.page';
import { DecisionLogPage } from '../pages/decision-log.page';
import { ExpensesPage } from '../pages/expenses.page';
import { LoginPage } from '../pages/login.page';

/** The page objects + a `loginAs` helper wired into every test via fixtures. */
interface AppFixtures {
  loginPage: LoginPage;
  expensesPage: ExpensesPage;
  adminPage: AdminPage;
  decisionLog: DecisionLogPage;
  /**
   * Navigate to the SPA, log in as a seeded user through the gateway, and return
   * the freshly-ready page objects. The whole stack is already up (globalSetup).
   */
  loginAs: (user: UserKey) => Promise<{
    loginPage: LoginPage;
    expensesPage: ExpensesPage;
    adminPage: AdminPage;
    decisionLog: DecisionLogPage;
  }>;
}

export const test = base.extend<AppFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  expensesPage: async ({ page }, use) => {
    await use(new ExpensesPage(page));
  },
  adminPage: async ({ page }, use) => {
    await use(new AdminPage(page));
  },
  decisionLog: async ({ page }, use) => {
    await use(new DecisionLogPage(page));
  },
  loginAs: async ({ loginPage, expensesPage, adminPage, decisionLog }, use) => {
    await use(async (user: UserKey) => {
      await loginPage.goto();
      await loginPage.loginAs(user);
      await expensesPage.waitReady();
      return { loginPage, expensesPage, adminPage, decisionLog };
    });
  },
});

export { expect } from '@playwright/test';
