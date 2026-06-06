/**
 * Application-layer command/query inputs. These are plain data shapes (no
 * framework decorators) handed from the controller to the use-cases. HTTP-facing
 * validation lives on the presentation request DTOs.
 */

export interface CreatePermissionCommand {
  /** Capability key formatted service:resource:action (e.g. expense:report:approve). */
  key: string;
  description: string;
}

export interface GetPermissionQuery {
  permissionId: string;
}

export interface ListPermissionsQuery {
  limit?: number;
  cursor?: string | null;
}
