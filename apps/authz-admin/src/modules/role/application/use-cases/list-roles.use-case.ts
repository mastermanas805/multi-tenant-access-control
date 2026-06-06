import { Inject, Injectable } from '@nestjs/common';

import { PageQuery } from '@kernel/core';

import { type RoleRepository, ROLE_REPOSITORY } from '../../domain/role.repository.port';
import { type ListRolesQuery } from '../dto/role.commands';
import { type RolePageView, toRolePageView } from '../dto/role.view';

/** Cursor-paginated listing of roles (tenant-scoped via RLS). */
@Injectable()
export class ListRolesUseCase {
  constructor(@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository) {}

  public async execute(query: ListRolesQuery): Promise<RolePageView> {
    const page = PageQuery.from({ limit: query.limit, cursor: query.cursor });
    const result = await this.roles.list(page);
    return toRolePageView(result);
  }
}
