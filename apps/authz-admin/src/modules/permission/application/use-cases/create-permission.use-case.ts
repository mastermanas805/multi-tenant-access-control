import { Inject, Injectable } from '@nestjs/common';

import {
  type Clock,
  CLOCK,
  type IDomainEventDispatcher,
  DOMAIN_EVENT_DISPATCHER,
} from '@kernel/core';

import { Permission } from '../../domain/permission.entity';
import { PermissionKeyTakenError } from '../../domain/permission.errors';
import {
  type PermissionRepository,
  PERMISSION_REPOSITORY,
} from '../../domain/permission.repository.port';
import { type CreatePermissionCommand } from '../dto/permission.commands';
import { type PermissionView, toPermissionView } from '../dto/permission.view';

/**
 * Registers a new capability in the GLOBAL permission catalog. Enforces key
 * uniqueness, builds the aggregate (which applies its own format invariants via
 * the PermissionKey value object), persists it, and returns the view.
 *
 * Depends only on the repository PORT token and the Clock port — no TypeORM,
 * no HTTP.
 */
@Injectable()
export class CreatePermissionUseCase {
  constructor(
    @Inject(PERMISSION_REPOSITORY) private readonly permissions: PermissionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DOMAIN_EVENT_DISPATCHER) private readonly dispatcher: IDomainEventDispatcher,
  ) {}

  public async execute(command: CreatePermissionCommand): Promise<PermissionView> {
    const existing = await this.permissions.findByKey(command.key);
    if (existing) {
      throw new PermissionKeyTakenError(command.key);
    }

    const permission = Permission.create({
      key: command.key,
      description: command.description,
      now: this.clock.now(),
    });

    await this.permissions.save(permission);

    // Publish after persistence so the source of truth is committed first
    // (DESIGN §3.4 sequence).
    await this.dispatcher.dispatch(permission.pullDomainEvents());

    return toPermissionView(permission);
  }
}
