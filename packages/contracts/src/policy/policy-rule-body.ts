/**
 * The STRUCTURED JSONB shape of a Policy aggregate's `rule` (DESIGN §8.7).
 *
 * In authz-admin the Policy aggregate stores `rule: Record<string, unknown>`
 * (opaque JSONB, DB-backed, user-defined at RUNTIME — never hardcoded). This is
 * the agreed concrete shape of that body so the PAP-publish agent can compile a
 * published policy version into a Cerbos `resourcePolicy` YAML deterministically
 * (DESIGN §3.1, §3.4) and hot-publish it to the PDP. Tenant admins author these
 * rules on the fly via the PAP API; nothing here is baked into any service.
 *
 * 1:1 mapping to Cerbos (see `@contracts/core` PolicyCompile* + the publish spec):
 *   PolicyRuleBody.resource     -> resourcePolicy.resource
 *   (Policy.scope, from the row) -> resourcePolicy.scope
 *   PolicyRuleBody.rules[]       -> resourcePolicy.rules[]
 *     rule.actions               -> rules[].actions
 *     rule.effect                -> rules[].effect (ALLOW->EFFECT_ALLOW, DENY->EFFECT_DENY)
 *     rule.roles                 -> rules[].roles
 *     rule.condition (CEL exprs) -> rules[].condition.match (all/any/expr)
 */

/** A single CEL expression, e.g. `request.resource.attr.amount < 10000`. */
export interface PolicyCelExpr {
  readonly expr: string;
}

/**
 * A boolean combinator over CEL expressions, mirroring Cerbos `match`:
 *   - `all`: every expression must hold (logical AND)
 *   - `any`: at least one must hold (logical OR)
 *   - `expr`: a single expression
 * Exactly one of the three is set. Recursive so nested all/any compose.
 */
export interface PolicyCondition {
  readonly all?: PolicyConditionOperand[];
  readonly any?: PolicyConditionOperand[];
  readonly expr?: string;
}

/** An operand inside an `all`/`any` is either a leaf expr or a nested condition. */
export type PolicyConditionOperand = PolicyCelExpr | PolicyCondition;

/** Effect of a rule, in the contract's neutral spelling (compiled to EFFECT_*). */
export type PolicyRuleEffect = 'ALLOW' | 'DENY';

/**
 * One authored rule: which roles, doing which actions, are allowed/denied, under
 * an optional attribute condition (DESIGN §3.1, FR-5). Compiles 1:1 to a Cerbos
 * `resourcePolicy.rules[]` entry.
 */
export interface PolicyRule {
  /** Action names (or `*`), e.g. `["approve"]` (DESIGN §3.1). */
  readonly actions: string[];
  readonly effect: PolicyRuleEffect;
  /** Role keys (or `*`) the rule applies to, e.g. `["finance_manager"]`. */
  readonly roles: string[];
  /** Optional ABAC condition (CEL). Omitted = unconditional rule. */
  readonly condition?: PolicyCondition;
  /** Optional human label surfaced as the decision `reason` (DESIGN §8.1/§11). */
  readonly name?: string;
}

/**
 * The full structured rule body stored in `Policy.rule` (JSONB). The `scope` is
 * NOT here — it lives on the Policy row (`Policy.scope`) and is stamped onto the
 * compiled `resourcePolicy.scope`, keeping one source of truth for the scope.
 */
export interface PolicyRuleBody {
  /** Cerbos resource kind this policy governs, e.g. `expense_report` (DESIGN §3.1). */
  readonly resource: string;
  /** Ordered rules; Cerbos evaluates with DENY-overrides within a scope. */
  readonly rules: PolicyRule[];
}
