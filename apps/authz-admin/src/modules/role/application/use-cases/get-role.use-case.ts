import { Inject, Injectable } from '@nestjs/common';

import { RoleNotFoundError } from '../../domain/role.errors';
import { type RoleRepository, ROLE_REPOSITORY } from '../../domain/role.repository.port';
import { RoleId } from '../../domain/value-objects/role-id.vo';
import { type GetRoleQuery } from '../dto/role.commands';
import { type RoleView, toRoleView } from '../dto/role.view';

/** Loads a single role by id, or raises a domain NotFound (mapped to 404). */
@Injectable()
export class GetRoleUseCase {
  constructor(@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository) {}

  public async execute(query: GetRoleQuery): Promise<RoleView> {
    const id = RoleId.fromString(query.roleId);
    const role = await this.roles.findById(id);
    if (!role) {
      throw new RoleNotFoundError(query.roleId);
    }
    return toRoleView(role);
  }
}
