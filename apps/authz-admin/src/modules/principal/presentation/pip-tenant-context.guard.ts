import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { type Request } from 'express';

import { UniqueEntityID } from '@kernel/core';

import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';

/**
 * Establishes the per-request tenant context for the PIP principal-resolution
 * endpoint (DESIGN §3.2, §6).
 *
 * Unlike the human-facing admin surfaces (which use TenantContextGuard reading the
 * `x-tenant-id` header), the PIP is a TRUSTED SERVICE-TO-SERVICE read: the
 * Expense PEP's @authz/pep HttpPipClient calls
 *   GET /v1/principals/:userId/effective?tenantId=&scope=
 * passing the active tenant as the `tenantId` QUERY parameter (no header). This
 * guard reads + validates that query param and binds it as the ambient tenant so
 * the RlsInterceptor scopes every read to it (DESIGN §6).
 *
 * PRODUCTION: this PIP sits behind the gateway/service mesh; the caller presents a
 * service token whose audience-scoped `tid` is the authoritative tenant. Swap the
 * `tenantId` query read for that verified claim — exactly as TenantContextGuard
 * documents for the header. Fail-closed: a missing/invalid tenant id is rejected.
 */
@Injectable()
export class PipTenantContextGuard implements CanActivate {
  public static readonly TENANT_QUERY = 'tenantId';

  constructor(private readonly tenantContext: TenantContextService) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const tenantId = this.extractTenantId(request);
    // The PIP read needs no platform-admin scope and no actor; bind tenant only.
    this.tenantContext.enterWith({ tenantId, isPlatformAdmin: false, actorId: null });
    return true;
  }

  private extractTenantId(request: Request): string {
    const raw = request.query[PipTenantContextGuard.TENANT_QUERY];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new UnauthorizedException(
        `Missing ${PipTenantContextGuard.TENANT_QUERY} query parameter (placeholder for the verified service-token tid claim)`,
      );
    }
    if (!UniqueEntityID.isValidUuid(value)) {
      throw new UnauthorizedException(`${PipTenantContextGuard.TENANT_QUERY} must be a valid UUID`);
    }
    return value;
  }
}
