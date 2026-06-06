/**
 * Application-layer command/query inputs. These are plain data shapes (no
 * framework decorators) handed from the controller to the use-cases. HTTP-facing
 * validation lives on the presentation request DTOs.
 *
 * The tenant id is NOT a field here: it is taken from the ambient tenant context
 * (DESIGN §6/§8.1 — tenant comes from the token `tid`, never the body), and RLS
 * scopes every row to it.
 */

export interface AssignRoleCommand {
  tenantId: string;
  userId: string;
  roleId: string;
  /** Hierarchical org-unit scope path, e.g. `acme.finance.emea`. */
  scope: string;
  /** ISO-8601 expiry for delegated/time-boxed grants; omitted = no expiry. */
  validUntil?: string | null;
  /** The delegating user, when this assignment is a delegation; else omitted. */
  delegatedBy?: string | null;
}

export interface RevokeRoleCommand {
  roleAssignmentId: string;
  /** Optimistic-concurrency guard from the `If-Match` ETag (DESIGN §8.1). */
  expectedVersion?: number;
}

export interface ListAssignmentsForUserQuery {
  userId: string;
  limit?: number;
  cursor?: string | null;
}
