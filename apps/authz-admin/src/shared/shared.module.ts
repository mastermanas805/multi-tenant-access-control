import { Global, Module } from '@nestjs/common';

import { CLOCK, DOMAIN_EVENT_DISPATCHER, SystemClock } from '@kernel/core';

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
 */
@Global()
@Module({
  providers: [
    TenantContextGuard,
    PlatformAdminGuard,
    { provide: CLOCK, useClass: SystemClock },
    { provide: DOMAIN_EVENT_DISPATCHER, useClass: LoggingDomainEventDispatcher },
  ],
  exports: [TenantContextGuard, PlatformAdminGuard, CLOCK, DOMAIN_EVENT_DISPATCHER],
})
export class SharedModule {}
