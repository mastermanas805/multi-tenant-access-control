import { ConflictError, NotFoundError } from '@kernel/core';

/** The requested permission does not exist. -> 404 */
export class PermissionNotFoundError extends NotFoundError {
  constructor(permissionId: string) {
    super(`Permission ${permissionId} not found`, 'permission_not_found');
  }
}

/** A permission with the same key already exists in the global catalog. -> 409 */
export class PermissionKeyTakenError extends ConflictError {
  constructor(key: string) {
    super(`Permission key "${key}" is already registered`, 'permission_key_taken');
  }
}
