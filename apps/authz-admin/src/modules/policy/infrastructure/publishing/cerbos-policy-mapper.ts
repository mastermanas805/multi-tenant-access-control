import {
  type CerbosPolicyDocument,
  type CerbosResourcePolicy,
  type PolicyRule,
  type PolicyRuleBody,
} from '@contracts/core';
import { compilePolicyToCerbos } from '@authz/pep';

import { PolicyCompileError } from '../../domain/policy.errors';

/** Cerbos requires version `default` on the resource policy (DESIGN §3.1 chain). */
const CERBOS_RESOURCE_VERSION = 'default';
/** The platform derived-roles every scoped policy imports (deploy/cerbos/policies). */
const PLATFORM_DERIVED_ROLES = ['platform_defaults'];

/**
 * The tenant-isolation guardrail (DESIGN §3.1, §6 layer 2). Compiled IN as the
 * FIRST rule of every scoped policy: a child-scope ALLOW would otherwise override
 * the parent base DENY (SCOPE_PERMISSIONS_OVERRIDE_PARENT), so relying only on the
 * base policy lets cross-tenant ALLOWs leak. An in-policy DENY wins via
 * deny-overrides WITHIN the policy regardless of scope semantics — making the
 * guardrail authoritative. Identical to the example compiled output committed in
 * deploy/cerbos/policies and verified against Cerbos 0.41.
 */
const TENANT_ISOLATION_GUARDRAIL: PolicyRule = {
  name: 'tenant_isolation_guardrail',
  actions: ['*'],
  effect: 'DENY',
  roles: ['*'],
  condition: { expr: 'request.resource.attr.tenantId != request.principal.attr.tenantId' },
};

/**
 * A single Cerbos policy document plus the canonical file name it should be
 * written under (`<resource>.<scope>.yaml`, or `<resource>.base.yaml` for the
 * scope-less base). Returning the name here keeps the FS adapter dumb (it only
 * serializes + writes) and makes the whole mapping unit-testable without a disk.
 */
export interface CerbosPolicyFile {
  readonly fileName: string;
  readonly document: CerbosPolicyDocument;
}

/**
 * Pure mapper from a published Policy version (its DB jsonb `rule`, plus the row's
 * `scope`/`version`/`id`) to the SET of Cerbos policy documents that must exist on
 * disk for the policy to be effective (DESIGN §3.4, §8.7). It:
 *
 *   1. parses + validates the opaque `rule` into the typed `PolicyRuleBody`;
 *   2. injects the tenant-isolation guardrail as the first rule;
 *   3. compiles via the SHARED `compilePolicyToCerbos` (@authz/pep);
 *   4. stamps `version: default` + `importDerivedRoles: [platform_defaults]`;
 *   5. emits empty-rules PASSTHROUGH stubs for every missing ANCESTOR scope (Cerbos
 *      rejects a scoped policy whose ancestors are absent).
 *
 * No filesystem, no NestJS — so it is exercised directly in unit tests.
 */
export function mapPolicyToCerbosFiles(args: {
  rule: Record<string, unknown>;
  scope: string;
  policyId: string;
  version: number;
}): CerbosPolicyFile[] {
  const { rule, scope, policyId, version } = args;
  const body = parseRuleBody(rule);

  // 1) Guardrail-first body (DESIGN §3.1 shows exactly this ordering).
  const guardedBody: PolicyRuleBody = {
    resource: body.resource,
    rules: [TENANT_ISOLATION_GUARDRAIL, ...body.rules],
  };

  // 2) Compile the leaf scope via the shared, typechecked function.
  const leaf = compilePolicyToCerbos({ body: guardedBody, scope, policyId, version });
  const files: CerbosPolicyFile[] = [withCerbosDefaults(leaf, scope)];

  // 3) Ancestor passthrough stubs so the scope chain resolves (DESIGN §3.1).
  for (const ancestor of ancestorScopes(scope)) {
    const stub = compilePolicyToCerbos({
      body: { resource: body.resource, rules: [] },
      scope: ancestor,
      policyId,
      version,
    });
    files.push(withCerbosDefaults(stub, ancestor));
  }

  return files;
}

/**
 * Validates + normalizes the opaque jsonb `rule` into a typed `PolicyRuleBody`.
 * The aggregate stores `Record<string, unknown>` (runtime-authored), so the
 * compile boundary is where we assert the agreed shape — a malformed body is a
 * domain error (-> 422), never an uncaught crash mid-write (fail-closed, D8).
 */
function parseRuleBody(rule: Record<string, unknown>): PolicyRuleBody {
  const { resource, rules: rawRules } = rule as { resource?: unknown; rules?: unknown };
  if (typeof resource !== 'string' || resource.trim().length === 0) {
    throw new PolicyCompileError('policy rule body is missing a non-empty "resource"');
  }
  if (!Array.isArray(rawRules)) {
    throw new PolicyCompileError('policy rule body "rules" must be an array');
  }
  const rules = rawRules.map((r, i) => parseRule(r, i));
  return { resource, rules };
}

function parseRule(value: unknown, index: number): PolicyRule {
  if (typeof value !== 'object' || value === null) {
    throw new PolicyCompileError(`policy rule[${String(index)}] must be an object`);
  }
  const { actions, effect, roles, condition, name } = value as {
    actions?: unknown;
    effect?: unknown;
    roles?: unknown;
    condition?: unknown;
    name?: unknown;
  };
  if (!isStringArray(actions) || actions.length === 0) {
    throw new PolicyCompileError(`policy rule[${String(index)}] needs a non-empty "actions" array`);
  }
  if (effect !== 'ALLOW' && effect !== 'DENY') {
    throw new PolicyCompileError(`policy rule[${String(index)}] effect must be "ALLOW" or "DENY"`);
  }
  if (!isStringArray(roles) || roles.length === 0) {
    throw new PolicyCompileError(`policy rule[${String(index)}] needs a non-empty "roles" array`);
  }
  // condition + name are validated structurally by compilePolicyToCerbos; pass
  // them through verbatim (the contract type is the source of truth).
  return {
    actions,
    effect,
    roles,
    ...(condition !== undefined ? { condition: condition as PolicyRule['condition'] } : {}),
    ...(typeof name === 'string' ? { name } : {}),
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Stamps the two Cerbos defaults `compilePolicyToCerbos` leaves to the caller
 * (DESIGN §3.1: always `version: default` + `importDerivedRoles`), and computes
 * the deterministic file name from the document's resource + scope.
 */
function withCerbosDefaults(doc: CerbosPolicyDocument, scope: string): CerbosPolicyFile {
  const resourcePolicy: CerbosResourcePolicy = {
    resource: doc.resourcePolicy.resource,
    version: CERBOS_RESOURCE_VERSION,
    ...(doc.resourcePolicy.scope ? { scope: doc.resourcePolicy.scope } : {}),
    importDerivedRoles: PLATFORM_DERIVED_ROLES,
    rules: doc.resourcePolicy.rules,
  };
  const document: CerbosPolicyDocument = { ...doc, resourcePolicy };
  return { fileName: fileNameFor(doc.resourcePolicy.resource, scope), document };
}

/** `expense_report.acme.finance.yaml`, or `expense_report.base.yaml` for base. */
function fileNameFor(resource: string, scope: string): string {
  const scopePart = scope.length > 0 ? scope : 'base';
  return `${resource}.${scopePart}.yaml`;
}

/**
 * The proper ANCESTOR scopes of `a.b.c`, most-specific first: `a.b`, `a`. The
 * base (empty scope) is platform-shipped, so it is NOT emitted here. A top-level
 * scope (`acme`) has no ancestors and yields an empty list.
 */
export function ancestorScopes(scope: string): string[] {
  if (scope.length === 0) {
    return [];
  }
  const labels = scope.split('.');
  const ancestors: string[] = [];
  for (let cut = labels.length - 1; cut >= 1; cut -= 1) {
    ancestors.push(labels.slice(0, cut).join('.'));
  }
  return ancestors;
}
