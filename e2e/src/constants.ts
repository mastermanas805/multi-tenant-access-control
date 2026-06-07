/**
 * Shared constants for the Playwright suite. These mirror the demo seed
 * (apps/web/src/config.ts, apps/expense + authz-admin seeds) so the assertions
 * can check the *visible* UI result against the known demo data.
 */

/** Where the Demo SPA is served (compose `web` container, nginx). */
export const WEB_URL = process.env.WEB_URL ?? 'http://localhost:8081';

/** The browser-reachable gateway edge (used by globalSetup health waits). */
export const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:8080';

/** Cerbos HTTP port — globalSetup waits until the published policy is effective. */
export const CERBOS_HTTP_URL = process.env.CERBOS_HTTP_URL ?? 'http://localhost:3592';

/** The seeded user keys the Login screen switches between. */
export type UserKey = 'riya' | 'sam' | 'dev';

/** Acme tenant UUID (matches the identity SEED_USERS `tid`). */
export const TENANT_ACME = 'aaaaaaaa-0000-4000-8000-000000000001';

/** Riya's user id — the Admin screen grants/revokes finance_manager on HER. */
export const RIYA_USER_ID = '11111111-1111-4111-8111-111111111111';

/** The seeded finance_manager role id (authz-admin seed). */
export const FINANCE_MANAGER_ROLE_ID = '0d000000-0000-4000-8000-000000000001';

/** Canonical demo expenses (apps/expense seed). */
export const EXPENSES = {
  /** $8,500 finance @ Acme — finance_manager same-dept, <10000 -> ALLOW. */
  allow: 'exp_42',
  /** $25,000 finance @ Acme — ABAC amount<10000 fails -> DENY. */
  abacDeny: 'exp_99',
  /** $4,200 ops @ Globex — an Acme principal is denied by the tenant guardrail. */
  crossTenant: 'exp_glx',
} as const;

/** The role label rendered under each login button (apps/web SEED_USERS). */
export const ROLE_LABEL: Record<UserKey, string> = {
  riya: 'finance_manager',
  sam: 'engineer',
  dev: 'org_admin',
};
