import {
  type CerbosPolicyFile,
  ancestorScopes,
  mapPolicyToCerbosFiles,
} from '../infrastructure/publishing/cerbos-policy-mapper';
import { PolicyCompileError } from '../domain/policy.errors';

/** Looks up the file for a scope, failing loudly (no non-null assertions). */
function byScope(files: CerbosPolicyFile[], scope: string): CerbosPolicyFile {
  const file = files.find((f) => f.document.resourcePolicy.scope === scope);
  if (!file) {
    throw new Error(`expected a compiled file for scope "${scope}"`);
  }
  return file;
}

/**
 * Unit tests for the policyCompileMapping (DESIGN §3.1, §3.4, §8.7). Exercise the
 * PURE mapper — no filesystem, no NestJS — so the compile contract is pinned
 * independently of the FS publisher. Mirrors the example compiled YAML committed
 * in deploy/cerbos/policies (verified against Cerbos 0.41).
 */
describe('cerbos policy mapper', () => {
  const financeRuleBody = {
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
            { expr: 'request.resource.attr.department == request.principal.attr.department' },
          ],
        },
      },
    ],
  };

  describe('mapPolicyToCerbosFiles', () => {
    it('compiles a scoped policy with the guardrail FIRST and the tenant rule second', () => {
      const files = mapPolicyToCerbosFiles({
        rule: financeRuleBody,
        scope: 'acme.finance',
        policyId: 'pol_1',
        version: 3,
      });

      // Leaf scope + one ancestor (`acme`); base is platform-shipped, not emitted.
      const rp = byScope(files, 'acme.finance').document.resourcePolicy;

      expect(rp.resource).toBe('expense_report');
      expect(rp.version).toBe('default');
      expect(rp.scope).toBe('acme.finance');
      expect(rp.importDerivedRoles).toEqual(['platform_defaults']);

      // Rule[0] is the tenant-isolation guardrail (DENY, all actions/roles).
      const guardrail = rp.rules[0];
      expect(guardrail?.name).toBe('tenant_isolation_guardrail');
      expect(guardrail?.effect).toBe('EFFECT_DENY');
      expect(guardrail?.actions).toEqual(['*']);
      expect(guardrail?.roles).toEqual(['*']);
      expect(guardrail?.condition?.match).toEqual({
        expr: 'request.resource.attr.tenantId != request.principal.attr.tenantId',
      });

      // Rule[1] is the authored finance rule, ALLOW + ABAC AND-condition.
      const tenantRule = rp.rules[1];
      expect(tenantRule?.name).toBe('finance_manager_approve');
      expect(tenantRule?.effect).toBe('EFFECT_ALLOW');
      expect(tenantRule?.actions).toEqual(['read', 'approve']);
      expect(tenantRule?.roles).toEqual(['finance_manager']);
      expect(tenantRule?.condition?.match).toEqual({
        all: {
          of: [
            { expr: 'request.resource.attr.amount < 10000' },
            { expr: 'request.resource.attr.department == request.principal.attr.department' },
          ],
        },
      });
    });

    it('emits an empty-rules PASSTHROUGH stub for each missing ancestor scope', () => {
      const files = mapPolicyToCerbosFiles({
        rule: financeRuleBody,
        scope: 'acme.finance.emea',
        policyId: 'pol_1',
        version: 1,
      });

      const scopes = files.map((f) => f.document.resourcePolicy.scope).sort();
      // leaf + two ancestors: acme.finance.emea, acme.finance, acme.
      expect(scopes).toEqual(['acme', 'acme.finance', 'acme.finance.emea']);

      const acme = byScope(files, 'acme').document.resourcePolicy;
      expect(acme.rules).toEqual([]);
      expect(acme.version).toBe('default');
      expect(acme.importDerivedRoles).toEqual(['platform_defaults']);
    });

    it('names each file deterministically as <resource>.<scope>.yaml', () => {
      const files = mapPolicyToCerbosFiles({
        rule: financeRuleBody,
        scope: 'acme.finance',
        policyId: 'pol_1',
        version: 1,
      });
      const names = files.map((f) => f.fileName).sort();
      expect(names).toEqual(['expense_report.acme.finance.yaml', 'expense_report.acme.yaml']);
    });

    it('stamps provenance metadata (storeIdentifier + annotations) from the row', () => {
      const files = mapPolicyToCerbosFiles({
        rule: financeRuleBody,
        scope: 'acme.finance',
        policyId: 'pol_42',
        version: 7,
      });
      const leaf = byScope(files, 'acme.finance').document;
      expect(leaf.metadata?.storeIdentifier).toBe('expense_report.acme.finance.v7');
      expect(leaf.metadata?.annotations).toMatchObject({
        policyId: 'pol_42',
        version: '7',
        scope: 'acme.finance',
      });
    });

    it('rejects a body missing "resource" with a PolicyCompileError', () => {
      expect(() =>
        mapPolicyToCerbosFiles({ rule: { rules: [] }, scope: 'acme', policyId: 'p', version: 1 }),
      ).toThrow(PolicyCompileError);
    });

    it('rejects a rule with an invalid effect', () => {
      expect(() =>
        mapPolicyToCerbosFiles({
          rule: {
            resource: 'expense_report',
            rules: [{ actions: ['read'], effect: 'MAYBE', roles: ['x'] }],
          },
          scope: 'acme',
          policyId: 'p',
          version: 1,
        }),
      ).toThrow(PolicyCompileError);
    });

    it('rejects a non-array "rules"', () => {
      expect(() =>
        mapPolicyToCerbosFiles({
          rule: { resource: 'expense_report', rules: 'nope' },
          scope: 'acme',
          policyId: 'p',
          version: 1,
        }),
      ).toThrow(PolicyCompileError);
    });
  });

  describe('ancestorScopes', () => {
    it('returns proper ancestors most-specific first', () => {
      expect(ancestorScopes('a.b.c')).toEqual(['a.b', 'a']);
    });
    it('returns empty for a top-level scope', () => {
      expect(ancestorScopes('acme')).toEqual([]);
    });
    it('returns empty for the empty (base) scope', () => {
      expect(ancestorScopes('')).toEqual([]);
    });
  });
});
