import { Global, Module } from '@nestjs/common';

import { CLOCK, DOMAIN_EVENT_DISPATCHER, SystemClock } from '@kernel/core';

import { LoggingDomainEventDispatcher } from './infrastructure/logging-domain-event.dispatcher';
import { IdentityTenantContextGuard } from './presentation/identity-tenant-context.guard';

/**
 * Exposes cross-cutting providers shared by all feature modules:
 *   - IdentityTenantContextGuard (attach per-controller with @UseGuards): binds
 *     the verified token tenant id into the DB tenant context for RLS (DESIGN §6).
 *   - CLOCK port -> SystemClock (use-cases inject CLOCK, never `new Date()`).
 *   - DOMAIN_EVENT_DISPATCHER port -> LoggingDomainEventDispatcher, bound ONCE
 *     here and exported so mutation use-cases can dispatch the domain events their
 *     aggregates raise (DESIGN §3.4).
 *
 * The RlsInterceptor and GlobalExceptionFilter are registered globally in
 * main.ts / app.module.ts. Global so feature modules need not re-import this.
 */
@Global()
@Module({
  providers: [
    IdentityTenantContextGuard,
    { provide: CLOCK, useClass: SystemClock },
    { provide: DOMAIN_EVENT_DISPATCHER, useClass: LoggingDomainEventDispatcher },
  ],
  exports: [IdentityTenantContextGuard, CLOCK, DOMAIN_EVENT_DISPATCHER],
})
export class SharedModule {}
