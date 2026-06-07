import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { load as yamlLoad } from 'js-yaml';

import { ConfigService } from '../../../config/config.service';
import { Policy } from '../domain/policy.entity';
import { PolicyScope } from '../domain/value-objects/policy-scope.vo';
import { FsCerbosPolicyPublisher } from '../infrastructure/publishing/fs-cerbos-policy.publisher';

/** Minimal shape of the parsed Cerbos YAML the assertions read (dot-notation). */
interface ParsedCerbosDocument {
  apiVersion: string;
  resourcePolicy: {
    resource: string;
    scope?: string;
    version?: string;
    importDerivedRoles?: string[];
    rules: { name?: string; effect?: string }[];
  };
}

/**
 * Integration-style test for the FS publisher: it actually writes Cerbos YAML to a
 * temp dir and we re-parse it. This covers the disk-write path the unit mapper
 * test cannot (atomic write, file naming, YAML round-trip). DESIGN §3.4, §8.7.
 */
describe('FsCerbosPolicyPublisher (disk)', () => {
  let dir: string;
  const now = new Date('2026-06-07T00:00:00.000Z');

  function makeConfig(policyDir: string): ConfigService {
    const config = new ConfigService();
    // ConfigService reads env once at construction; override the dir for the test.
    Object.defineProperty(config, 'values', {
      value: { ...config.values, CERBOS_POLICY_DIR: policyDir },
      configurable: true,
    });
    return config;
  }

  function publishedPolicy(scope: string): Policy {
    const policy = Policy.publish({
      scope: PolicyScope.fromString(scope),
      rule: {
        resource: 'expense_report',
        rules: [
          {
            name: 'finance_manager_approve',
            actions: ['read', 'approve'],
            effect: 'ALLOW',
            roles: ['finance_manager'],
            condition: { all: [{ expr: 'request.resource.attr.amount < 10000' }] },
          },
        ],
      },
      version: 1,
      effectiveDate: now,
      now,
    });
    policy.pullDomainEvents();
    policy.stampTenant('aaaaaaaa-0000-4000-8000-000000000001');
    return policy;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cerbos-pub-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the leaf scope + ancestor stub as valid Cerbos YAML', async () => {
    const publisher = new FsCerbosPolicyPublisher(makeConfig(dir));

    await publisher.publish(publishedPolicy('acme.finance'));

    const files = readdirSync(dir).sort();
    expect(files).toEqual(['expense_report.acme.finance.yaml', 'expense_report.acme.yaml']);

    const leaf = yamlLoad(
      readFileSync(join(dir, 'expense_report.acme.finance.yaml'), 'utf8'),
    ) as ParsedCerbosDocument;
    expect(leaf.apiVersion).toBe('api.cerbos.dev/v1');
    const rp = leaf.resourcePolicy;
    expect(rp.resource).toBe('expense_report');
    expect(rp.scope).toBe('acme.finance');
    expect(rp.version).toBe('default');
    expect(rp.importDerivedRoles).toEqual(['platform_defaults']);
    expect(rp.rules[0]?.name).toBe('tenant_isolation_guardrail');
    expect(rp.rules[0]?.effect).toBe('EFFECT_DENY');
    expect(rp.rules[1]?.name).toBe('finance_manager_approve');
  });

  it('leaves no temp files behind (atomic rename)', async () => {
    const publisher = new FsCerbosPolicyPublisher(makeConfig(dir));
    await publisher.publish(publishedPolicy('acme.finance'));
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});
