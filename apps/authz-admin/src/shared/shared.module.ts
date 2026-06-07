import { Global, Module } from '@nestjs/common';

import { CLOCK, DOMAIN_EVENT_DISPATCHER, SystemClock } from '@kernel/core';
import { AUTHZ_OPTIONS, type AuthzModuleOptions, IdentityContextMiddleware } from '@authz/pep';

import { ConfigService } from '../config/config.service';
import { LoggingDomainEventDispatcher } from './infrastructure/logging-domain-event.dispatcher';
import { PlatformAdminGuard } from './presentation/platform-admin.guard';
import { TenantContextGuard } from './presentation/tenant-context.guard';

/**
 * Exposes cross-cutting providers shared by all feature modules:
 *   - TenantContextGuard + PlatformAdminGuard (attach per-controller with
 *     @UseGuards; PlatformAdminGuard gates platform-wide surfaces — DESIGN §6).
 *   - CLOCK port -> SystemClock (use-cases inject CLOCK, never `new Date()`).
 *   - DOMAIN_EVENT_DISPATCHER port -> LoggingDomainEventDispatcher, bound ONCE
 *     here and exported so EVERY module's mutation use-cases can dispatch the
 *     domain events their aggregates raise (DESIGN §3.4 / FR-8). Binding it
 *     globally is what makes the dynamic-management seam uniform across modules
 *     rather than wired in a single flow.
 *
 * The RlsInterceptor and GlobalExceptionFilter are registered globally in
 * main.ts / app.module.ts. Global so feature modules need not re-import this.
 *
 * It also provides AUTHZ_OPTIONS + the reusable PEP IdentityContextMiddleware so
 * the PAP can VERIFY the gateway's signed internal token and derive the principal
 * (tenant/actor/platform-admin) from it (DESIGN §5, §7). The PAP is a control plane,
 * not a Cerbos PEP, so it wires ONLY the middleware (not the full AuthzModule's
 * PDP/PIP/Audit clients) — internalTokenSecret/issuer/clockTolerance come from the
 * typed config; the other AuthzModuleOptions fields are unused by the middleware.
 */
@Global()
@Module({
  providers: [
    TenantContextGuard,
    PlatformAdminGuard,
    { provide: CLOCK, useClass: SystemClock },
    { provide: DOMAIN_EVENT_DISPATCHER, useClass: LoggingDomainEventDispatcher },
    {
      provide: AUTHZ_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AuthzModuleOptions => ({
        // The PAP is not a Cerbos PEP; these endpoints are unused by the middleware
        // but the AuthzModuleOptions contract requires them. Point them at the
        // PAP's own config where meaningful (CERBOS_URL) and leave the rest inert.
        cerbosUrl: config.values.CERBOS_URL,
        papUrl: '',
        auditUrl: '',
        // The signature-verification wiring the IdentityContextMiddleware actually
        // consumes. Empty secret -> DEV/TEST placeholder; set -> production verify.
        internalTokenSecret: config.values.INTERNAL_TOKEN_SECRET,
        internalTokenIssuer: config.values.INTERNAL_TOKEN_ISSUER,
        internalTokenClockToleranceSeconds: config.values.INTERNAL_TOKEN_CLOCK_TOLERANCE_SECONDS,
      }),
    },
    IdentityContextMiddleware,
  ],
  exports: [
    TenantContextGuard,
    PlatformAdminGuard,
    CLOCK,
    DOMAIN_EVENT_DISPATCHER,
    AUTHZ_OPTIONS,
    IdentityContextMiddleware,
  ],
})
export class SharedModule {}
