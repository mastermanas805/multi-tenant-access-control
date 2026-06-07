/**
 * Demo configuration (DESIGN §13). The SPA talks ONLY to the API Gateway; the
 * base URL is injected at build/run time via VITE_GATEWAY_URL and falls back to
 * the local compose edge. NO downstream service URL is ever referenced here.
 */
export const GATEWAY_URL: string = (
  import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080'
).replace(/\/$/, '');

/** A seeded demo user the login screen can switch between (compose SEED_USERS). */
export interface SeedUser {
  readonly key: 'riya' | 'sam' | 'dev';
  readonly name: string;
  readonly role: string;
  readonly email: string;
  readonly password: string;
  /** The Identity JWT `sub` (UUID) — used to look up this user's grants in Admin. */
  readonly userId: string;
  /** True for the org_admin, who sees the Admin screen. */
  readonly isAdmin: boolean;
}

/**
 * The three seeded users (apps/identity SEED_USERS + authz-admin seed). The UUIDs
 * MUST match the identity `sub` and the role-assignment `user_id` keyed by UUID,
 * so the Admin screen can list a user's grants through the gateway.
 */
export const SEED_USERS: readonly SeedUser[] = [
  {
    key: 'riya',
    name: 'Riya',
    role: 'finance_manager',
    email: 'riya@acme.com',
    password: 'Password123!',
    userId: '11111111-1111-4111-8111-111111111111',
    isAdmin: false,
  },
  {
    key: 'sam',
    name: 'Sam',
    role: 'engineer',
    email: 'sam@acme.com',
    password: 'Password123!',
    userId: '22222222-2222-4222-8222-222222222222',
    isAdmin: false,
  },
  {
    key: 'dev',
    name: 'Dev',
    role: 'org_admin',
    email: 'dev@acme.com',
    password: 'Password123!',
    userId: '33333333-3333-4333-8333-333333333333',
    isAdmin: true,
  },
];

/** Riya's user id — the Admin screen grants/revokes finance_manager on HER. */
export const RIYA_USER_ID = '11111111-1111-4111-8111-111111111111';

/** The seeded finance_manager role id (authz-admin seed) — needed to GRANT. */
export const FINANCE_MANAGER_ROLE_ID = '0d000000-0000-4000-8000-000000000001';

/** The org-unit scope finance_manager is granted at (matches the demo policy). */
export const FINANCE_SCOPE = 'acme.finance';

/**
 * The canonical demo expenses (apps/expense seed). The list endpoint is
 * PDP-FILTERED to what the caller may *read*, so a denied user (e.g. Sam) gets an
 * empty list. To honour the §13 security note ("hiding a button is UX, not
 * security"), the UI ALSO renders an Approve button for these known ids even when
 * the server omitted them — so you can ATTEMPT a denied approve and see the 403.
 */
export const DEMO_EXPENSE_IDS: readonly string[] = ['exp_42', 'exp_99', 'exp_glx'];
