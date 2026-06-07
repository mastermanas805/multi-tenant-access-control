// @contracts/core — shared cross-service contracts (pure TypeScript, no framework deps).
// Every type is re-exported here; services import from '@contracts/core' only.

// Identity / token (DESIGN §5, §7)
export { type InternalIdentityToken } from './identity/internal-identity-token';
export { type EffectivePrincipal } from './identity/principal-attributes';

// Decision API contract (DESIGN §8.2 /pdp/v1/check, FR-6)
export {
  type AttributeBag,
  type PdpPrincipal,
  type PdpResource,
  type PdpCheckRequest,
  type PdpEffect,
  type PdpActionResult,
  type PdpCheckResult,
} from './pdp/pdp';

// Audit decision record (DESIGN §8.7, FR-9)
export { type DecisionAuditRecord } from './pdp/audit-record';

// Error envelope (DESIGN §8.1)
export { type ErrorEnvelope, type ErrorEnvelopeBody } from './errors/error-envelope';

// Expense domain DTOs (DESIGN §8.2, §13)
export {
  type ExpenseStatus,
  EXPENSE_RESOURCE_KIND,
  type ExpenseAction,
  type ExpenseDto,
  type CreateExpenseRequest,
  type ApproveExpenseRequest,
  type ApproveExpenseResponse,
  type ExpensePage,
} from './expense/expense';

// Policy rule body — the DB jsonb shape (DESIGN §8.7) the PAP authors at runtime
export {
  type PolicyCelExpr,
  type PolicyCondition,
  type PolicyConditionOperand,
  type PolicyRuleEffect,
  type PolicyRule,
  type PolicyRuleBody,
} from './policy/policy-rule-body';

// Cerbos compilation target (DESIGN §3.1) — what the PAP-publish agent emits
export {
  type CerbosMatch,
  type CerbosMatchOperand,
  type CerbosEffect,
  type CerbosResourceRule,
  type CerbosResourcePolicy,
  type CerbosPolicyDocument,
} from './policy/cerbos-resource-policy';
