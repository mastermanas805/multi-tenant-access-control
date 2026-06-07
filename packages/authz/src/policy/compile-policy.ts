import {
  type CerbosMatch,
  type CerbosMatchOperand,
  type CerbosPolicyDocument,
  type CerbosResourceRule,
  type PolicyCondition,
  type PolicyConditionOperand,
  type PolicyRule,
  type PolicyRuleBody,
} from '@contracts/core';

/**
 * Compiles a published Policy version into a Cerbos `resourcePolicy` document
 * (DESIGN §3.1, §8.7). This is the SHARED, TYPECHECKED implementation of the
 * policyCompileMapping the PAP-publish agent uses: it takes the DB jsonb
 * (`PolicyRuleBody`) + the Policy row's `scope`/`version` and produces the exact
 * document to serialize to YAML and drop in `deploy/cerbos/policies/`.
 *
 * Mapping (1:1):
 *   body.resource            -> resourcePolicy.resource
 *   scope (from the row)     -> resourcePolicy.scope
 *   body.rules[].actions     -> rules[].actions
 *   body.rules[].effect      -> rules[].effect (ALLOW->EFFECT_ALLOW, DENY->EFFECT_DENY)
 *   body.rules[].roles       -> rules[].roles
 *   body.rules[].condition   -> rules[].condition.match (all/any/expr, recursive)
 *   body.rules[].name        -> rules[].name (surfaced in the decision for `reason`)
 *   policyId/version         -> metadata.storeIdentifier + annotations (provenance)
 */
export function compilePolicyToCerbos(args: {
  body: PolicyRuleBody;
  scope: string;
  policyId: string;
  version: number;
}): CerbosPolicyDocument {
  const { body, scope, policyId, version } = args;

  const rules: CerbosResourceRule[] = body.rules.map((rule, index) => compileRule(rule, index));

  return {
    apiVersion: 'api.cerbos.dev/v1',
    metadata: {
      storeIdentifier: `${body.resource}.${scope}.v${String(version)}`,
      annotations: { policyId, version: String(version), scope },
    },
    resourcePolicy: {
      resource: body.resource,
      ...(scope ? { scope } : {}),
      rules,
    },
  };
}

function compileRule(rule: PolicyRule, index: number): CerbosResourceRule {
  const base: CerbosResourceRule = {
    actions: rule.actions,
    effect: rule.effect === 'ALLOW' ? 'EFFECT_ALLOW' : 'EFFECT_DENY',
    roles: rule.roles,
    name: rule.name ?? `rule_${String(index)}`,
  };
  if (rule.condition === undefined) {
    return base;
  }
  return { ...base, condition: { match: compileCondition(rule.condition) } };
}

/** Maps the contract's PolicyCondition to a Cerbos `match` block (recursive). */
function compileCondition(condition: PolicyCondition): CerbosMatch {
  if (condition.all !== undefined) {
    return { all: { of: condition.all.map(compileOperand) } };
  }
  if (condition.any !== undefined) {
    return { any: { of: condition.any.map(compileOperand) } };
  }
  if (condition.expr !== undefined) {
    return { expr: condition.expr };
  }
  // An empty condition is a no-op match (Cerbos treats a bare `expr: "true"`).
  return { expr: 'true' };
}

function compileOperand(operand: PolicyConditionOperand): CerbosMatchOperand {
  // A nested all/any is a condition; otherwise a leaf with a single `expr`.
  if ('all' in operand && operand.all !== undefined) {
    return compileCondition(operand);
  }
  if ('any' in operand && operand.any !== undefined) {
    return compileCondition(operand);
  }
  if (typeof operand.expr === 'string') {
    return { expr: operand.expr };
  }
  return compileCondition(operand);
}
