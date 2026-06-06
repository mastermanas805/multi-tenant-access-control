/**
 * Application-layer command/query inputs. These are plain data shapes (no
 * framework decorators) handed from the controller to the use-cases. HTTP-facing
 * validation lives on the presentation request DTOs.
 */

export interface CreateRoleCommand {
  /** The tenant that owns this role (ambient — stamped from the request context). */
  tenantId: string;
  key: string;
  scope: string;
  description?: string;
  /** Permission keys in `service:resource:action` form (DESIGN §3, FR-4). */
  permissions?: string[];
}

export interface GetRoleQuery {
  roleId: string;
}

export interface ListRolesQuery {
  limit?: number;
  cursor?: string | null;
}

export interface AddPermissionToRoleCommand {
  roleId: string;
  permission: string;
  /** Optimistic-concurrency guard from the `If-Match` ETag (DESIGN §8.1). */
  expectedVersion?: number;
}

export interface RemovePermissionFromRoleCommand {
  roleId: string;
  permission: string;
  /** Optimistic-concurrency guard from the `If-Match` ETag (DESIGN §8.1). */
  expectedVersion?: number;
}
