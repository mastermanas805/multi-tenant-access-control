import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

import { ForbiddenError } from '@kernel/core';
import {
  type EffectivePrincipal,
  EXPENSE_RESOURCE_KIND,
  type PdpCheckResult,
} from '@contracts/core';
import {
  type AuditSink,
  AuthzGuard,
  type AuthorizeOptions,
  type CerbosPdpClient,
  type LoadedResource,
  type PipClient,
} from '@authz/pep';

/**
 * Unit tests for the PEP enforcement of the Expense `approve` route, driving the
 * @authz/pep AuthzGuard directly with a MOCKED PDP + PIP + AuditSink and the exact
 * Expense @Authorize options. Covers the three decision paths the spec calls out:
 * ALLOW, PDP DENY, and the cheap tenant guardrail (DESIGN §4.3 step 3, §6).
 *
 * The guard is the framework-agnostic seam; testing it here proves the Expense
 * resource is enforced correctly without standing up HTTP or a real Cerbos.
 */
describe('Expense PEP enforcement (AuthzGuard, mocked PDP+PIP)', () => {
  const ACME = 'aaaaaaaa-0000-4000-8000-000000000001';
  const GLOBEX = 'bbbbbbbb-0000-4000-8000-000000000002';

  const acmePrincipal = {
    principalId: 'riya',
    tenantId: ACME,
    actorId: 'riya',
    sessionId: 'sess_1',
  };

  const effective: EffectivePrincipal = {
    id: 'riya',
    tenantId: ACME,
    roles: ['finance_manager'],
    attr: { tenantId: ACME, department: 'finance' },
  };

  /** The Expense approve route's authorization spec (mirrors the controller). */
  function approveOptions(resource: LoadedResource | null): AuthorizeOptions {
    return {
      action: 'approve',
      resourceKind: EXPENSE_RESOURCE_KIND,
      sensitive: true,
      loadResource: () => Promise.resolve(resource),
    };
  }

  function makeContext(principal: typeof acmePrincipal | undefined): {
    context: ExecutionContext;
    request: { authzPrincipal?: typeof acmePrincipal; authzDecision?: unknown; traceId: string };
  } {
    const request = { authzPrincipal: principal, traceId: 'trc_test' } as {
      authzPrincipal?: typeof acmePrincipal;
      authzDecision?: unknown;
      traceId: string;
    };
    const context = {
      getHandler: () => approveHandler,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  // A stable handler reference for the reflector mock to key on.
  const approveHandler = (): void => undefined;

  function makeGuard(opts: {
    options: AuthorizeOptions;
    decision?: PdpCheckResult;
    pdpThrows?: Error;
    effectiveResult?: EffectivePrincipal;
  }): {
    guard: AuthzGuard;
    pdpCheck: jest.Mock;
    pipResolve: jest.Mock;
    auditRecord: jest.Mock;
  } {
    const reflector = { get: jest.fn().mockReturnValue(opts.options) } as unknown as Reflector;
    const pdpCheck = jest.fn();
    if (opts.pdpThrows) {
      pdpCheck.mockRejectedValue(opts.pdpThrows);
    } else {
      pdpCheck.mockResolvedValue(opts.decision);
    }
    const pdp = { check: pdpCheck } as unknown as CerbosPdpClient;
    const pipResolve = jest.fn().mockResolvedValue(opts.effectiveResult ?? effective);
    const pip = { resolve: pipResolve } as unknown as PipClient;
    const auditRecord = jest.fn();
    const audit = { record: auditRecord } as unknown as AuditSink;

    return { guard: new AuthzGuard(reflector, pdp, pip, audit), pdpCheck, pipResolve, auditRecord };
  }

  const acmeResource: LoadedResource = {
    id: 'exp_42',
    scope: 'acme.finance',
    attr: { tenantId: ACME, amount: 8500, department: 'finance', ownerId: 'riya' },
  };

  it('ALLOW: a same-dept finance_manager under the limit passes and the decision is exposed', async () => {
    const decision: PdpCheckResult = {
      decisionId: 'dec_allow',
      results: [{ action: 'approve', effect: 'ALLOW', policy: 'expense_report/acme.finance' }],
    };
    const { guard, pipResolve, auditRecord } = makeGuard({
      options: approveOptions(acmeResource),
      decision,
    });
    const { context, request } = makeContext(acmePrincipal);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // sensitive: true -> the PIP was asked for a FRESH read (forceFresh=true).
    expect(pipResolve).toHaveBeenCalledWith('riya', ACME, 'acme.finance', true);
    expect(request.authzDecision).toEqual({ decisionId: 'dec_allow', results: decision.results });
    // The decision was audited (allow path).
    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord.mock.calls[0][0]).toMatchObject({
      effect: 'ALLOW',
      action: 'approve',
      resourceKind: EXPENSE_RESOURCE_KIND,
      resourceId: 'exp_42',
      decisionId: 'dec_allow',
    });
  });

  it('DENY: an over-limit expense is denied with the §8.1 reason + decisionId, still audited', async () => {
    const decision: PdpCheckResult = {
      decisionId: 'dec_deny',
      results: [
        {
          action: 'approve',
          effect: 'DENY',
          policy: 'expense_report/acme.finance',
          reason: 'denied by expense_report/acme.finance',
        },
      ],
    };
    const overLimit: LoadedResource = {
      ...acmeResource,
      id: 'exp_99',
      attr: { ...acmeResource.attr, amount: 25000 },
    };
    const { guard, auditRecord } = makeGuard({
      options: approveOptions(overLimit),
      decision,
    });
    const { context } = makeContext(acmePrincipal);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      reason: 'denied by expense_report/acme.finance',
      decisionId: 'dec_deny',
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenError);
    // The DENY was still emitted to the audit sink.
    expect(auditRecord).toHaveBeenCalled();
    expect(auditRecord.mock.calls[0][0]).toMatchObject({ effect: 'DENY', resourceId: 'exp_99' });
  });

  it('TENANT GUARDRAIL: a cross-tenant resource is denied BEFORE the PDP/PIP are called', async () => {
    const globexResource: LoadedResource = {
      id: 'exp_glx',
      scope: 'globex',
      attr: { tenantId: GLOBEX, amount: 4200, department: 'ops', ownerId: 'gframe' },
    };
    const { guard, pdpCheck, pipResolve } = makeGuard({
      options: approveOptions(globexResource),
      decision: { decisionId: 'unused', results: [] },
    });
    const { context } = makeContext(acmePrincipal);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      reason: 'tenant isolation guardrail',
    });
    // The cheap guardrail fired first — neither the PIP nor the PDP were consulted.
    expect(pipResolve).not.toHaveBeenCalled();
    expect(pdpCheck).not.toHaveBeenCalled();
  });

  it('404: a missing resource is a NotFound, never an implicit allow', async () => {
    const { guard } = makeGuard({
      options: approveOptions(null),
      decision: { decisionId: 'unused', results: [] },
    });
    const { context } = makeContext(acmePrincipal);
    await expect(guard.canActivate(context)).rejects.toThrow();
  });

  it('401: no authenticated principal context is rejected', async () => {
    const { guard } = makeGuard({
      options: approveOptions(acmeResource),
      decision: { decisionId: 'unused', results: [] },
    });
    const { context } = makeContext(undefined);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fail-closed: a PDP transport error denies (never an implicit allow)', async () => {
    const { guard } = makeGuard({
      options: approveOptions(acmeResource),
      pdpThrows: new Error('cerbos unreachable'),
    });
    const { context } = makeContext(acmePrincipal);
    await expect(guard.canActivate(context)).rejects.toThrow('cerbos unreachable');
  });
});
