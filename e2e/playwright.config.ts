import { defineConfig, devices } from '@playwright/test';

import { WEB_URL } from './src/constants';

/**
 * Playwright config for the full-stack customer-flow suite.
 *
 * - globalSetup brings the WHOLE compose stack up + bootstraps the demo policy
 *   and waits for health + the runtime-published Cerbos policy.
 * - globalTeardown drops the stack (docker compose down -v).
 * - The suite drives the real Demo UI (apps/web served by nginx on :8081) through
 *   the gateway to the services — no mocks, no request stubbing (except ONE
 *   negative-auth test that forces a bad-credential login).
 *
 * Reliability: NO sleeps. Every wait is on a data-testid or a captured network
 * Response. The dynamic-revocation (FR-8) flow mutates shared server state, so we
 * run with a single worker to keep the demo grant deterministic.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './src/global-setup.ts',
  globalTeardown: './src/global-teardown.ts',
  /* Shared mutable backend state (the finance_manager grant) -> serialize. */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
