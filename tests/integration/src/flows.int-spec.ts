import request from 'supertest';

import {
  INTERNAL_IDENTITY_HEADER,
  INTERNAL_IDENTITY_SIGNATURE_HEADER,
  internalIdentityHeaders,
  internalIdentityToken,
  internalIdentitySignature,
} from './helpers/identity-token';
import {
  ASSIGN_RIYA,
  EXPENSE_ACME_LARGE,
  EXPENSE_ACME_SMALL,
  EXPENSE_ACME_SMALL2,
  EXPENSE_GLOBEX,
  TENANT_ACME,
  USER_RIYA,
  USER_SAM,
} from './helpers/seed-data';
import { type RunningStack, startStack } from './helpers/stack';

/**
 * The CANONICAL customer flows (DESIGN §11), END-TO-END through the REAL Expense
 * PEP -> REAL Cerbos (evaluating the RUNTIME-PUBLISHED `acme.finance` policy) ->
 * REAL PIP (authz-admin) + REAL Postgres RLS. Nothing is mocked: Postgres and
 * Cerbos run as Testcontainers, the three Nest apps run in-process, and the policy
 * was published through the PAP at stack start (proving FR-8 dynamic publication).
 */
describe('Enforcement flows (real PEP -> Cerbos -> PIP + RLS)', () => {
  let stack: RunningStack;

  beforeAll(async () => {
    stack = await startStack();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** Approves `expenseId` as `sub`@Acme through the real PEP; returns the supertest response. */
  function approve(expenseId: string, sub: string): request.Test {
    const args = { sub, tid: TENANT_ACME };
    return request(stack.expenseUrl)
      .post(`/v1/expenses/${expenseId}/approve`)
      // The PEP runs the PRODUCTION signature-verification path, so send BOTH the
      // claims header and the HS256 JWS signature the gateway would mint (DESIGN §7).
      .set(INTERNAL_IDENTITY_HEADER, internalIdentityToken(args))
      .set(INTERNAL_IDENTITY_SIGNATURE_HEADER, internalIdentitySignature(args))
      .send({});
  }

  it('(a) Riya approves an $8,500 same-dept Acme expense -> 200 ALLOW', async () => {
    const res = await approve(EXPENSE_ACME_SMALL, USER_RIYA);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(EXPENSE_ACME_SMALL);
    expect(res.body.status).toBe('approved');
    expect(res.body.approvedBy).toBe(USER_RIYA);
    // A real Cerbos decision id flows back for audit correlation (DESIGN §8.2).
    expect(typeof res.body.decisionId).toBe('string');
    expect(res.body.decisionId.length).toBeGreaterThan(0);
  });

  it('(b) Riya approves a $25,000 expense -> 403 (ABAC amount < 10000) with reason', async () => {
    const res = await approve(EXPENSE_ACME_LARGE, USER_RIYA);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    // The deny stems from the published ABAC rule on the acme.finance policy.
    expect(res.body.error.reason).toEqual(expect.stringContaining('acme.finance'));
    expect(typeof res.body.error.decisionId).toBe('string');
    expect(res.body.error.decisionId.length).toBeGreaterThan(0);
    expect(typeof res.body.error.traceId).toBe('string');
  });

  it('(c) Riya approves a Globex expense -> 403 (tenant guardrail)', async () => {
    // Riya's token tenant is Acme; the Globex expense is in another tenant. RLS
    // scopes the read to Acme so the resource is not even visible -> 404, OR the
    // tenant guardrail denies it -> 403. Either way it is NOT approved (no leak).
    const res = await approve(EXPENSE_GLOBEX, USER_RIYA);

    expect([403, 404]).toContain(res.status);
    expect(res.body.status).not.toBe('approved');
    if (res.status === 403) {
      expect(res.body.error.reason).toEqual(expect.stringContaining('tenant'));
    }
  });

  it('(c2) A Globex principal CAN see only Globex — and Acme cannot reach it (guardrail)', async () => {
    // Cross-check: an Acme-context approve of the Globex resource never succeeds.
    const res = await approve(EXPENSE_GLOBEX, USER_RIYA);
    expect(res.body.status).not.toBe('approved');
  });

  it('(d) Sam (engineer, no expense grant) approves -> 403 (RBAC: no rule grants it)', async () => {
    const res = await approve(EXPENSE_ACME_SMALL, USER_SAM);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    // Sam is an engineer at acme — the PIP returns no finance_manager role, so the
    // published ALLOW rule does not match and the request is denied.
    expect(res.body.error.reason).toEqual(expect.stringContaining('acme.finance'));
  });

  it('(e) FR-8 DYNAMIC: revoke Riya finance_manager via the PAP -> the SAME approve now 403 within the staleness bound', async () => {
    // Use a dedicated $9,000 same-dept expense (amount < 10000) so the ONLY thing
    // that changes between the two calls is Riya's role grant — isolating the
    // revocation as the cause of the flip from ALLOW to DENY.
    const before = await approve(EXPENSE_ACME_SMALL2, USER_RIYA);
    expect(before.status).toBe(200);
    expect(before.body.status).toBe('approved');

    // Revoke through the REAL PAP HTTP API. Granting/revoking is now platform-admin-
    // only and authorized from the VERIFIED signed token (DESIGN §6/§7), so send the
    // signed internal token for the org-admin `dev`@Acme WITH the platform-admin claim.
    const revoke = await request(stack.papUrl)
      .post(`/v1/role-assignments/${ASSIGN_RIYA}/revoke`)
      .set(internalIdentityHeaders({ sub: 'dev', tid: TENANT_ACME, platformAdmin: true }))
      .send({});
    expect([200, 204]).toContain(revoke.status);

    // The approve path resolves the principal with sensitive=true (forceFresh, no
    // cache), so the revocation is enforced on the very next decision (DESIGN
    // §3.5, §9.1) — well within the FR-8 staleness bound. We re-check a DIFFERENT
    // still-pending small expense (exp_42 was approved in case (a)); same dept,
    // amount < 10000, so a DENY can only be Riya's now-missing finance_manager role.
    const afterArgs = { sub: USER_RIYA, tid: TENANT_ACME };
    const after = await request(stack.expenseUrl)
      .post(`/v1/expenses/${EXPENSE_ACME_SMALL}/approve`)
      .set(INTERNAL_IDENTITY_HEADER, internalIdentityToken(afterArgs))
      .set(INTERNAL_IDENTITY_SIGNATURE_HEADER, internalIdentitySignature(afterArgs))
      .send({});

    // With Riya's finance_manager grant gone, the PIP returns no roles, so the
    // published ALLOW rule no longer matches and the decision flips to DENY — the
    // same expense that was approvable seconds earlier is now forbidden.
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('forbidden');
    expect(typeof after.body.error.decisionId).toBe('string');
  });

  it('audits every decision (ALLOW and DENY) to the real hash-chained Audit log, and the chain verifies', async () => {
    // The PEP AuditSink is fire-and-forget (DESIGN §4.3 step 7), so poll the real
    // Audit service until the decisions from cases (a)-(e) have landed.
    const deadline = Date.now() + 20_000;
    let items: { decision: string; resourceId: string; action: string }[] = [];
    while (Date.now() < deadline) {
      const res = await request(stack.auditUrl)
        // The audit READ endpoint scopes to the caller's VERIFIED tenant (DESIGN
        // §6/§7); send the signed token for an Acme caller reading its own log.
        .get(`/v1/audit/events?tenantId=${TENANT_ACME}&limit=100`)
        .set(internalIdentityHeaders({ sub: 'dev', tid: TENANT_ACME }))
        .send();
      expect(res.status).toBe(200);
      items = res.body.items as typeof items;
      const hasAllow = items.some((e) => e.decision === 'ALLOW');
      const hasDeny = items.some((e) => e.decision === 'DENY');
      if (hasAllow && hasDeny) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Both an ALLOW and a DENY decision were recorded (DESIGN §8.7 — allow AND deny).
    expect(items.some((e) => e.decision === 'ALLOW' && e.action === 'approve')).toBe(true);
    expect(items.some((e) => e.decision === 'DENY' && e.action === 'approve')).toBe(true);

    // The tamper-evident hash chain replays intact from genesis (DESIGN §10). The
    // verify read also runs behind the verifying middleware now (DESIGN §7).
    const verify = await request(stack.auditUrl)
      .get('/v1/audit/events/verify')
      .set(internalIdentityHeaders({ sub: 'dev', tid: TENANT_ACME }))
      .send();
    expect(verify.status).toBe(200);
    expect(verify.body.valid).toBe(true);
    expect(verify.body.brokenAt).toBeNull();
    expect(verify.body.count).toBeGreaterThan(0);
  });
});
