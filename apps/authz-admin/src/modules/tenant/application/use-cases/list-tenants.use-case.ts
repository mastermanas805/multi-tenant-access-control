import { Inject, Injectable } from '@nestjs/common';

import { PageQuery } from '@kernel/core';

import { type TenantRepository, TENANT_REPOSITORY } from '../../domain/tenant.repository.port';
import { type ListTenantsQuery } from '../dto/tenant.commands';
import { type TenantPageView, toTenantPageView } from '../dto/tenant.view';

/** Cursor-paginated listing of tenants. */
@Injectable()
export class ListTenantsUseCase {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository) {}

  public async execute(query: ListTenantsQuery): Promise<TenantPageView> {
    const page = PageQuery.from({ limit: query.limit, cursor: query.cursor });
    const result = await this.tenants.list(page);
    return toTenantPageView(result);
  }
}
