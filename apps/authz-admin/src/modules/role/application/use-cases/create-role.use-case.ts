import { Inject, Injectable } from '@nestjs/common';

import { type Clock, CLOCK } from '@kernel/core';

import { Role } from '../../domain/role.entity';
import { RoleKeyTakenError } from '../../domain/role.errors';
import { type RoleRepository, ROLE_REPOSITORY } from '../../domain/role.repository.port';
import { type CreateRoleCommand } from '../dto/role.commands';
import { type RoleView, toRoleView } from '../dto/role.view';

/**
 * Creates a new role. Enforces key uniqueness per tenant, builds the aggregate
 * (which applies its own invariants on key/scope/permission shape), persists it,
 * and returns the view.
 *
 * Tenant scoping is ambient: the key-uniqueness lookup runs under RLS so it only
 * sees this tenant's rows, and the new row's tenant_id is stamped by the
 * repository from the same request context. Depends only on the repository PORT
 * token and the Clock port — no TypeORM, no HTTP.
 */
@Injectable()
export class CreateRoleUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: CreateRoleCommand): Promise<RoleView> {
    const existing = await this.roles.findByKey(command.key);
    if (existing) {
      throw new RoleKeyTakenError(command.key);
    }

    const role = Role.create({
      tenantId: command.tenantId,
      key: command.key,
      scope: command.scope,
      description: command.description,
      permissions: command.permissions,
      now: this.clock.now(),
    });

    await this.roles.save(role);

    return toRoleView(role);
  }
}
