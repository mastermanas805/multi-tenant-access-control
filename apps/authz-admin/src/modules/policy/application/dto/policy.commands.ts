/**
 * Application-layer command/query inputs. These are plain data shapes (no
 * framework decorators) handed from the controller to the use-cases. HTTP-facing
 * validation lives on the presentation request DTOs.
 */

export interface PublishPolicyCommand {
  scope: string;
  rule: Record<string, unknown>;
  /** When the policy version should take effect (ISO string from the request). */
  effectiveDate: string;
}

export interface ActivatePolicyCommand {
  policyId: string;
  /** Optimistic-concurrency guard from the `If-Match` ETag (DESIGN §8.1). */
  expectedVersion?: number;
}

export interface RollbackPolicyCommand {
  /** The policy whose scope is being rolled back. */
  policyId: string;
  /** The previously-published version whose rule is republished as a new version. */
  toVersion: number;
}

export interface GetPolicyQuery {
  policyId: string;
}

export interface ListPoliciesQuery {
  limit?: number;
  cursor?: string | null;
}
