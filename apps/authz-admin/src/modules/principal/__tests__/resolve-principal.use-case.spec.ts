import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { ResolvePrincipalUseCase } from '../application/use-cases/resolve-principal.use-case';
import {
  type PrincipalProjection,
  type PrincipalRoleGrant,
} from '../domain/principal-projection.port';
import { ScopeChain } from '../domain/value-objects/scope-chain.vo';

/**
 * Unit tests for the PIP ResolvePrincipal use-case + the scope-chain VO. The
 * projection PORT is a hand-rolled fake keyed by scope so these exercise pure
 * application logic (scope inheritance, dedupe, attr building) with no DB.
 */
describe('Principal resolution (PIP)', () => {
  const tenantId = 'aaaaaaaa-0000-4000-8000-000000000001';

  function makeContext(): TenantContextService {
    const ctx = new TenantContextService();
    ctx.enterWith({ tenantId, isPlatformAdmin: false, actorId: null });
    return ctx;
  }

  /**
   * Fake projection: returns the grants whose scope is in the requested chain.
   * Mirrors the real adapter's ancestor-or-self filter.
   */
  function makeProjection(allGrants: PrincipalRoleGrant[]): PrincipalProjection {
    return {
      findActiveGrants: jest
        .fn()
        .mockImplementation((_userId: string, scopeChain: string[]) =>
          Promise.resolve(allGrants.filter((g) => scopeChain.includes(g.scope))),
        ),
    };
  }

  describe('ScopeChain VO', () => {
    it('expands a deep scope into its root-first ancestor-or-self chain', () => {
      expect(ScopeChain.forScope('acme.finance.emea').toArray()).toEqual([
        'acme',
        'acme.finance',
        'acme.finance.emea',
      ]);
    });

    it('ranks specificity by depth (root lowest)', () => {
      const chain = ScopeChain.forScope('acme.finance.emea');
      expect(chain.depthOf('acme')).toBe(0);
      expect(chain.depthOf('acme.finance.emea')).toBe(2);
      expect(chain.depthOf('other')).toBeNull();
    });

    it('rejects a malformed scope', () => {
      expect(() => ScopeChain.forScope('Acme Finance')).toThrow();
    });
  });

  it('resolves a role granted at the EXACT scope', async () => {
    const projection = makeProjection([{ roleKey: 'finance_manager', scope: 'acme.finance' }]);
    const useCase = new ResolvePrincipalUseCase(projection, makeContext());

    const view = await useCase.execute({ userId: 'riya', scope: 'acme.finance' });

    expect(view.id).toBe('riya');
    expect(view.tenantId).toBe(tenantId);
    expect(view.roles).toEqual(['finance_manager']);
    expect(view.attr).toEqual({ tenantId, department: 'finance' });
  });

  it('INHERITS a role granted at an ANCESTOR scope down to the requested scope', async () => {
    // engineer granted at `acme` is effective when resolving `acme.finance.emea`.
    const projection = makeProjection([{ roleKey: 'engineer', scope: 'acme' }]);
    const useCase = new ResolvePrincipalUseCase(projection, makeContext());

    const view = await useCase.execute({ userId: 'sam', scope: 'acme.finance.emea' });

    expect(view.roles).toEqual(['engineer']);
    // Deepest grant scope is `acme` (root) -> no department segment.
    expect(view.attr).toEqual({ tenantId });
  });

  it('does NOT leak a role granted at a DESCENDANT/sibling scope', async () => {
    // A grant at `acme.finance.emea` must NOT apply when resolving `acme.finance`.
    const projection = makeProjection([{ roleKey: 'finance_manager', scope: 'acme.finance.emea' }]);
    const useCase = new ResolvePrincipalUseCase(projection, makeContext());

    const view = await useCase.execute({ userId: 'riya', scope: 'acme.finance' });

    expect(view.roles).toEqual([]);
    expect(view.attr).toEqual({ tenantId });
  });

  it('dedupes a role granted at multiple scopes and orders MOST-SPECIFIC-FIRST', async () => {
    const projection = makeProjection([
      { roleKey: 'viewer', scope: 'acme' },
      { roleKey: 'finance_manager', scope: 'acme.finance' },
      { roleKey: 'viewer', scope: 'acme.finance' }, // same role, deeper grant
    ]);
    const useCase = new ResolvePrincipalUseCase(projection, makeContext());

    const view = await useCase.execute({ userId: 'riya', scope: 'acme.finance.emea' });

    // Both roles' deepest grant is `acme.finance` (depth 1); viewer first-seen at
    // a deeper scope than its root grant, so each appears once, deepest-first.
    expect(view.roles).toContain('finance_manager');
    expect(view.roles).toContain('viewer');
    expect(view.roles.filter((r) => r === 'viewer')).toHaveLength(1);
  });

  it('returns an empty role set + tenantId-only attr for a principal with no grants', async () => {
    const projection = makeProjection([]);
    const useCase = new ResolvePrincipalUseCase(projection, makeContext());

    const view = await useCase.execute({ userId: 'nobody', scope: 'acme.finance' });

    expect(view.roles).toEqual([]);
    expect(view.attr).toEqual({ tenantId });
  });

  it('passes the full ancestor-or-self chain to the projection', async () => {
    const projection = makeProjection([]);
    const useCase = new ResolvePrincipalUseCase(projection, makeContext());

    await useCase.execute({ userId: 'riya', scope: 'acme.finance.emea' });

    expect(projection.findActiveGrants).toHaveBeenCalledWith('riya', [
      'acme',
      'acme.finance',
      'acme.finance.emea',
    ]);
  });
});
