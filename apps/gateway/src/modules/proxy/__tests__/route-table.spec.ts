import { resolveRoute } from '../domain/route-table';

describe('resolveRoute (routing table — DESIGN §4.1)', () => {
  it('routes /auth/* to identity as a PUBLIC route', () => {
    expect(resolveRoute('/auth/token')).toEqual({ upstream: 'identity', requiresAuth: false });
    expect(resolveRoute('/auth/refresh')).toEqual({ upstream: 'identity', requiresAuth: false });
    expect(resolveRoute('/auth')).toEqual({ upstream: 'identity', requiresAuth: false });
  });

  it('routes /v1/auth/* to identity as a PUBLIC route (the SPA logs in via /v1)', () => {
    expect(resolveRoute('/v1/auth/token')).toEqual({ upstream: 'identity', requiresAuth: false });
    expect(resolveRoute('/v1/auth/refresh')).toEqual({
      upstream: 'identity',
      requiresAuth: false,
    });
  });

  it('routes /v1/audit* to audit (authenticated decision-log read)', () => {
    expect(resolveRoute('/v1/audit')).toEqual({ upstream: 'audit', requiresAuth: true });
    expect(resolveRoute('/v1/audit/events')).toEqual({ upstream: 'audit', requiresAuth: true });
    expect(resolveRoute('/v1/audit/events/verify')).toEqual({
      upstream: 'audit',
      requiresAuth: true,
    });
  });

  it('routes /v1/expenses* to expense (authenticated)', () => {
    expect(resolveRoute('/v1/expenses')).toEqual({ upstream: 'expense', requiresAuth: true });
    expect(resolveRoute('/v1/expenses/42')).toEqual({ upstream: 'expense', requiresAuth: true });
    expect(resolveRoute('/v1/expenses/42/approve')).toEqual({
      upstream: 'expense',
      requiresAuth: true,
    });
  });

  it('routes each authz-admin IAM collection to authz-admin (authenticated)', () => {
    for (const c of [
      'tenants',
      'org-units',
      'roles',
      'permissions',
      'role-assignments',
      'policies',
    ]) {
      expect(resolveRoute(`/v1/${c}`)).toEqual({ upstream: 'authz-admin', requiresAuth: true });
      expect(resolveRoute(`/v1/${c}/abc`)).toEqual({ upstream: 'authz-admin', requiresAuth: true });
    }
  });

  it('routes /admin/* to authz-admin (authenticated)', () => {
    expect(resolveRoute('/admin/anything')).toEqual({
      upstream: 'authz-admin',
      requiresAuth: true,
    });
  });

  it('returns null for unknown paths (edge 404, no upstream leak)', () => {
    expect(resolveRoute('/v1/payroll')).toBeNull();
    expect(resolveRoute('/random')).toBeNull();
    expect(resolveRoute('/health')).toBeNull();
  });

  it('does NOT match a longer segment (path-confusion / route-smuggling defense)', () => {
    // `/v1/expensesX` must NOT be treated as `/v1/expenses`.
    expect(resolveRoute('/v1/expensesX')).toBeNull();
    expect(resolveRoute('/v1/tenantsX')).toBeNull();
    expect(resolveRoute('/adminX')).toBeNull();
  });

  it('normalizes a trailing slash', () => {
    expect(resolveRoute('/v1/expenses/')).toEqual({ upstream: 'expense', requiresAuth: true });
  });
});
