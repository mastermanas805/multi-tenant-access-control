/**
 * Application-layer command/query inputs. These are plain data shapes (no
 * framework decorators) handed from the controller to the use-cases. HTTP-facing
 * validation lives on the presentation request DTOs.
 */

export interface CreateTenantCommand {
  name: string;
  slug: string;
  /** One of the IsolationTier enum values; defaults to "pool" when omitted. */
  isolationTier?: string;
}

export interface GetTenantQuery {
  tenantId: string;
}

export interface ListTenantsQuery {
  limit?: number;
  cursor?: string | null;
}

export interface SuspendTenantCommand {
  tenantId: string;
  reason: string;
  /** Optimistic-concurrency guard from the `If-Match` ETag (DESIGN §8.1). */
  expectedVersion?: number;
}
