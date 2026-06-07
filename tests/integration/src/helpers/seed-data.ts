/**
 * Canonical seed identifiers shared by the integration suites — they MUST match
 * the service seeds (apps/authz-admin/.../seed.ts and apps/expense/.../seed.ts)
 * so a single internal identity token resolves end-to-end across the PAP, the
 * PEP and Postgres RLS.
 */

/** Tenant UUIDs (also the `tid` carried in the internal identity token). */
export const TENANT_ACME = 'aaaaaaaa-0000-4000-8000-000000000001';
export const TENANT_GLOBEX = 'bbbbbbbb-0000-4000-8000-000000000002';

/** Demo principals — the role-assignment `user_id`s in the authz-admin seed. */
export const USER_RIYA = 'riya'; // finance_manager @ acme.finance (department finance)
export const USER_SAM = 'sam'; // engineer @ acme (no expense grant)
export const USER_DEV = 'dev'; // org_admin @ acme

/** Riya's role-assignment id (for the FR-8 dynamic-revocation flow). */
export const ASSIGN_RIYA = '0e000000-0000-4000-8000-000000000001';

/** Demo expenses seeded into the expense DB. */
export const EXPENSE_ACME_SMALL = 'exp_42'; // $8,500 finance @ Acme  (ALLOW)
export const EXPENSE_ACME_SMALL2 = 'exp_43'; // $9,000 finance @ Acme  (ALLOW until revoked — FR-8 probe)
export const EXPENSE_ACME_LARGE = 'exp_99'; // $25,000 finance @ Acme (DENY: amount)
export const EXPENSE_GLOBEX = 'exp_glx'; // $4,200 ops @ Globex (DENY: tenant guardrail)

/** The org-tree scope the demo policy is published at and the Acme expenses carry. */
export const SCOPE_ACME_FINANCE = 'acme.finance';

/**
 * The runtime-authored policy rule body the test publishes through the PAP
 * (POST /v1/policies). This is the DB jsonb (PolicyRuleBody) that the PAP compiles
 * to a Cerbos resource policy and writes into the watched dir — proving the rule
 * is DYNAMICALLY published, not pre-baked into the image (FR-8, DESIGN §3.1/§3.4):
 *
 *   finance_manager may read/approve an expense_report when
 *     amount < 10000  AND  resource.department == principal.department
 *
 * The tenant-isolation guardrail is injected by the PAP's compiler as the first
 * rule of every scoped policy, so it is NOT (and must not be) authored here.
 */
export const DEMO_EXPENSE_POLICY_RULE = {
  resource: 'expense_report',
  rules: [
    {
      name: 'finance_manager_approve',
      actions: ['read', 'approve'],
      effect: 'ALLOW',
      roles: ['finance_manager'],
      condition: {
        all: [
          { expr: 'request.resource.attr.amount < 10000' },
          {
            expr: 'request.resource.attr.department == request.principal.attr.department',
          },
        ],
      },
    },
  ],
} as const;
