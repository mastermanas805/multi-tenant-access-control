import { Inject, Injectable } from '@nestjs/common';

import { PageQuery } from '@kernel/core';

import {
  type PermissionRepository,
  PERMISSION_REPOSITORY,
} from '../../domain/permission.repository.port';
import { type ListPermissionsQuery } from '../dto/permission.commands';
import { type PermissionPageView, toPermissionPageView } from '../dto/permission.view';

/** Cursor-paginated listing of the global permission catalog. */
@Injectable()
export class ListPermissionsUseCase {
  constructor(@Inject(PERMISSION_REPOSITORY) private readonly permissions: PermissionRepository) {}

  public async execute(query: ListPermissionsQuery): Promise<PermissionPageView> {
    const page = PageQuery.from({ limit: query.limit, cursor: query.cursor });
    const result = await this.permissions.list(page);
    return toPermissionPageView(result);
  }
}
