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
 * Establishes the per-request tenant context (DESIGN §6).
 *
 * PRODUCTION: the tenant id comes from the verified JWT `tid` claim, set by the
 * IdP and never by the client. This service is the PAP, so a real deployment
 * sits behind the gateway that validates the admin JWT.
 *
 * THIS REFERENCE IMPL: as a documented placeholder we read a validated
 * `x-tenant-id` header (must be a UUID). This is the ONLY thing to swap when
 * wiring the real JWT — replace `extractTenantId` with the `tid` claim read.
 *
 * The guard runs `TenantContextService.run(...)` for the remainder of the
 * request so the RlsInterceptor and repositories see the tenant.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  public static readonly TENANT_HEADER = 'x-tenant-id';

  /**
   * Placeholder for the verified JWT platform-admin scope/role claim (DESIGN §6).
   * In production this is a claim minted by the IdP and validated at the edge —
   * NEVER set by the client. Here it is a documented header so the authorization
   * model is exercisable; swap it for the claim read alongside `extractTenantId`.
   */
  public static readonly PLATFORM_ADMIN_HEADER = 'x-platform-admin';

  /**
   * Placeholder for the verified JWT `sub` claim — the authenticated CALLER's
   * identity (the actor). In production this is minted by the IdP and validated at
   * the edge, NEVER set by the client. Here it is a documented header so the
   * server can stamp audit-relevant attributes (e.g. role-assignment
   * `delegatedBy`) from the caller's identity rather than trusting the request
   * body; swap it for the `sub` claim read alongside `extractTenantId`.
   */
  public static readonly ACTOR_HEADER = 'x-actor-id';

  constructor(private readonly tenantContext: TenantContextService) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const tenantId = this.extractTenantId(request);
    const isPlatformAdmin = this.extractPlatformAdmin(request);
    const actorId = this.extractActorId(request);

    // Bind the tenant context for the remainder of this async request so the
    // RlsInterceptor, controllers, use-cases and repositories all see it.
    this.tenantContext.enterWith({ tenantId, isPlatformAdmin, actorId });
    return true;
  }

  /** Placeholder for the real JWT `tid` claim. Validates a UUID tenant header. */
  private extractTenantId(request: Request): string {
    const header = request.headers[TenantContextGuard.TENANT_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || value.trim().length === 0) {
      throw new UnauthorizedException(
        `Missing ${TenantContextGuard.TENANT_HEADER} header (placeholder for JWT tid claim)`,
      );
    }
    if (!UniqueEntityID.isValidUuid(value)) {
      throw new UnauthorizedException(`${TenantContextGuard.TENANT_HEADER} must be a valid UUID`);
    }
    return value;
  }

  /**
   * Placeholder for the verified JWT platform-admin claim. Reads the
   * `x-platform-admin` header and treats only the exact value `true` as the
   * scope being present (fail-closed for anything else).
   */
  private extractPlatformAdmin(request: Request): boolean {
    const header = request.headers[TenantContextGuard.PLATFORM_ADMIN_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    return value?.trim().toLowerCase() === 'true';
  }

  /**
   * Placeholder for the verified JWT `sub` claim. Reads the `x-actor-id` header
   * and returns the caller's identity, or null when none was presented. Never
   * read from the request BODY — that is what allows audit-attribute spoofing.
   */
  private extractActorId(request: Request): string | null {
    const header = request.headers[TenantContextGuard.ACTOR_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }
}
