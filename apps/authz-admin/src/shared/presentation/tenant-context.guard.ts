import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { type Request } from 'express';

import { UniqueEntityID } from '@kernel/core';
import { IdentityContextMiddleware } from '@authz/pep';

import { TenantContextService } from '../infrastructure/database/tenant-context';

/**
 * Establishes the per-request tenant context for the PAP's human-facing IAM
 * surfaces (DESIGN §6) from the VERIFIED principal — never plaintext headers.
 *
 * The PEP's IdentityContextMiddleware (mounted in AppModule.configure) has already
 * verified the gateway-signed internal identity token and populated
 * `req.authzPrincipal` with the principal's tenant (`tid`), actor and the
 * platform-admin scope. This guard reads ONLY that verified context and binds it
 * into the TenantContextService so the RlsInterceptor scopes every query, the
 * PlatformAdminGuard can authorize platform-wide surfaces, and use-cases can stamp
 * audit attributes (e.g. role-assignment `delegatedBy`) from the caller's identity.
 *
 * This is the hardened S2S path (DESIGN §7): because identity comes from the signed
 * token rather than `x-tenant-id`/`x-actor-id`/`x-platform-admin` headers, a party
 * that can reach the PAP directly on the mesh (SSRF, a compromised co-located
 * service, a misconfigured NetworkPolicy) cannot forge a tenant + platform-admin
 * context against the IAM control plane.
 *
 * Fail-closed: a missing principal context or a non-UUID tenant id is rejected
 * (401) rather than letting an unscoped query through.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  /**
   * OpenAPI documentation reference for the signed internal identity token header
   * the gateway injects and the PEP middleware VERIFIES (the base64url(JSON) claims
   * + its HS256 JWS signature header carry the tenant/actor/platform-admin context).
   * Identity is NEVER taken from a client-settable header — these are documented so
   * the contract is discoverable, not because a caller supplies them.
   */
  public static readonly TENANT_HEADER = IdentityContextMiddleware.TOKEN_HEADER;
  /** Signature header documented alongside the identity token (DESIGN §7). */
  public static readonly SIGNATURE_HEADER = IdentityContextMiddleware.SIGNATURE_HEADER;

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
    // RlsInterceptor, controllers, use-cases and repositories all see it. Every
    // field is sourced from the VERIFIED signed token (confused-deputy defense):
    //  - tenantId       -> the token `tid` claim (drives RLS);
    //  - isPlatformAdmin-> the verified `platformAdmin` claim (gates platform-wide
    //                      surfaces; absent -> false, fail-closed);
    //  - actorId        -> the token `actorId` claim (stamped server-side as e.g.
    //                      role-assignment `delegatedBy`, never read from the body).
    this.tenantContext.enterWith({
      tenantId: principal.tenantId,
      isPlatformAdmin: principal.platformAdmin,
      actorId: principal.actorId,
    });
    return true;
  }
}
