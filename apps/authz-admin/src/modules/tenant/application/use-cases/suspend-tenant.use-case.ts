import { Inject, Injectable } from '@nestjs/common';

import {
  ConflictError,
  type Clock,
  CLOCK,
  type IDomainEventDispatcher,
  DOMAIN_EVENT_DISPATCHER,
} from '@kernel/core';

import { TenantNotFoundError } from '../../domain/tenant.errors';
import { type TenantRepository, TENANT_REPOSITORY } from '../../domain/tenant.repository.port';
import { TenantId } from '../../domain/value-objects/tenant-id.vo';
import { type SuspendTenantCommand } from '../dto/tenant.commands';
import { type TenantView, toTenantView } from '../dto/tenant.view';

/**
 * Suspends a tenant. Honors optimistic concurrency (DESIGN §8.1): when the
 * caller supplies an expected version (from the `If-Match` ETag) it must match
 * the loaded aggregate, else a ConflictError (-> 409) is raised. The aggregate
 * records a TenantSuspendedEvent which the dispatcher publishes after save.
 */
@Injectable()
export class SuspendTenantUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DOMAIN_EVENT_DISPATCHER) private readonly dispatcher: IDomainEventDispatcher,
  ) {}

  public async execute(command: SuspendTenantCommand): Promise<TenantView> {
    const id = TenantId.fromString(command.tenantId);
    const tenant = await this.tenants.findById(id);
    if (!tenant) {
      throw new TenantNotFoundError(command.tenantId);
    }

    if (command.expectedVersion !== undefined && command.expectedVersion !== tenant.version) {
      throw new ConflictError('Tenant was modified by another request', 'version_mismatch');
    }

    tenant.suspend(command.reason, this.clock.now());
    await this.tenants.save(tenant);

    // Publish after persistence so the source of truth is committed before any
    // downstream consumer reacts (DESIGN §3.4 sequence).
    await this.dispatcher.dispatch(tenant.pullDomainEvents());

    return toTenantView(tenant);
  }
}
