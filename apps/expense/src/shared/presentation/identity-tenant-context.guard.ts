import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { type Request } from 'express';

import { UniqueEntityID } from '@kernel/core';

import { TenantContextService } from '../infrastructure/database/tenant-context';

/**
 * Bridges the PEP's authenticated principal context to the DB tenant context
 * (DESIGN §6). The PEP's IdentityContextMiddleware has already populated
 * `req.authzPrincipal` from the verified internal identity token (token `tid` =
 * the active tenant). This guard binds that tenant id into the
 * TenantContextService so the RlsInterceptor can run
 * `SET LOCAL app.current_tenant` and Postgres RLS scopes every query to the
 * tenant — the SAME `tid` the PEP later checks the resource against.
 *
 * Single source of truth: the tenant comes ONLY from the verified token, never a
 * client header or request body. Guards run before interceptors in Nest, so the
 * context is bound before the RlsInterceptor opens its tenant-scoped transaction.
 *
 * Fail-closed: a missing principal context or a non-UUID tenant id is rejected
 * (401) rather than letting an unscoped query through.
 */
@Injectable()
export class IdentityTenantContextGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.authzPrincipal;
    if (!principal) {
      throw new UnauthorizedException('No authenticated principal context on the request');
    }
    if (!UniqueEntityID.isValidUuid(principal.tenantId)) {
      throw new UnauthorizedException('Internal identity token carries a non-UUID tenant id');
    }

    // Bind the tenant context for the remainder of this async request so the
    // RlsInterceptor, controllers, use-cases and repositories all see it.
    this.tenantContext.enterWith({ tenantId: principal.tenantId });
    return true;
  }
}
