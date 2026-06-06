import { type CanActivate, ForbiddenException, Injectable } from '@nestjs/common';

import { TenantContextService } from '../infrastructure/database/tenant-context';

/**
 * Authorizes PLATFORM-ADMIN-only surfaces (DESIGN §6 / App. A — SoD on admin
 * roles): tenant lifecycle and writes to the GLOBAL permission catalog. These act
 * on platform-wide resources (the `tenants` table is global; the `permissions`
 * catalog is shared by every tenant and has no RLS), so establishing a tenant
 * context is NOT sufficient — without this gate any tenant could read/suspend
 * another tenant or pollute the shared catalog (a cross-tenant breach).
 *
 * MUST be listed AFTER TenantContextGuard in @UseGuards so the context (carrying
 * the verified platform-admin claim) is already bound. Fail-closed: a missing or
 * non-admin claim yields 403 `forbidden`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  public canActivate(): boolean {
    if (!this.tenantContext.isPlatformAdmin()) {
      throw new ForbiddenException('Platform-admin scope required for this operation');
    }
    return true;
  }
}
