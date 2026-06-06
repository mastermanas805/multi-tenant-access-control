import { Inject, Injectable } from '@nestjs/common';

import { type Clock, CLOCK } from '@kernel/core';

import { IsolationTier } from '../../domain/value-objects/isolation-tier.vo';
import { Tenant } from '../../domain/tenant.entity';
import { TenantSlugTakenError } from '../../domain/tenant.errors';
import { type TenantRepository, TENANT_REPOSITORY } from '../../domain/tenant.repository.port';
import { type CreateTenantCommand } from '../dto/tenant.commands';
import { type TenantView, toTenantView } from '../dto/tenant.view';

/**
 * Creates a new tenant. Enforces slug uniqueness, builds the aggregate (which
 * applies its own invariants), persists it, and returns the view.
 *
 * Depends only on the repository PORT token and the Clock port — no TypeORM,
 * no HTTP. This is the template every other use-case follows.
 */
@Injectable()
export class CreateTenantUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: CreateTenantCommand): Promise<TenantView> {
    const existing = await this.tenants.findBySlug(command.slug);
    if (existing) {
      throw new TenantSlugTakenError(command.slug);
    }

    const tenant = Tenant.create({
      name: command.name,
      slug: command.slug,
      isolationTier: command.isolationTier
        ? IsolationTier.fromString(command.isolationTier)
        : undefined,
      now: this.clock.now(),
    });

    await this.tenants.save(tenant);

    return toTenantView(tenant);
  }
}
