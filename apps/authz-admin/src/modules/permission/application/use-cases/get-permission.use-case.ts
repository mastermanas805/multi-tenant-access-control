import { Inject, Injectable } from '@nestjs/common';

import { PermissionNotFoundError } from '../../domain/permission.errors';
import {
  type PermissionRepository,
  PERMISSION_REPOSITORY,
} from '../../domain/permission.repository.port';
import { PermissionId } from '../../domain/value-objects/permission-id.vo';
import { type GetPermissionQuery } from '../dto/permission.commands';
import { type PermissionView, toPermissionView } from '../dto/permission.view';

/** Loads a single permission by id, or raises a domain NotFound (mapped to 404). */
@Injectable()
export class GetPermissionUseCase {
  constructor(@Inject(PERMISSION_REPOSITORY) private readonly permissions: PermissionRepository) {}

  public async execute(query: GetPermissionQuery): Promise<PermissionView> {
    const id = PermissionId.fromString(query.permissionId);
    const permission = await this.permissions.findById(id);
    if (!permission) {
      throw new PermissionNotFoundError(query.permissionId);
    }
    return toPermissionView(permission);
  }
}
