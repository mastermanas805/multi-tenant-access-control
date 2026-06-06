import { Inject, Injectable } from '@nestjs/common';

import { TenantNotFoundError } from '../../domain/tenant.errors';
import { type TenantRepository, TENANT_REPOSITORY } from '../../domain/tenant.repository.port';
import { TenantId } from '../../domain/value-objects/tenant-id.vo';
import { type GetTenantQuery } from '../dto/tenant.commands';
import { type TenantView, toTenantView } from '../dto/tenant.view';

/** Loads a single tenant by id, or raises a domain NotFound (mapped to 404). */
@Injectable()
export class GetTenantUseCase {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository) {}

  public async execute(query: GetTenantQuery): Promise<TenantView> {
    const id = TenantId.fromString(query.tenantId);
    const tenant = await this.tenants.findById(id);
    if (!tenant) {
      throw new TenantNotFoundError(query.tenantId);
    }
    return toTenantView(tenant);
  }
}
