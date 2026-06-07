import { Global, Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '@kernel/core';
import { AUTHZ_OPTIONS, type AuthzModuleOptions, IdentityContextMiddleware } from '@authz/pep';

import { ConfigService } from '../config/config.service';

/**
 * Exposes cross-cutting providers shared by the feature module:
 *   - CLOCK port -> SystemClock (use-cases inject CLOCK, never `new Date()`),
 *     so the `decidedAt`/`receivedAt` stamping is deterministic in tests.
 *   - AUTHZ_OPTIONS + the reusable PEP IdentityContextMiddleware, so the audit READ
 *     endpoints VERIFY the gateway-signed internal token and the read controller can
 *     scope the decision log to the caller's verified tenant (DESIGN §5/§6/§7).
 *
 * The audit log is append-only and not tenant-RLS-scoped (it is the compliance
 * system of record, a separate trust boundary — DESIGN §8.7 / App. C), so unlike
 * the OLTP services there is no TenantContextGuard / RlsInterceptor here; tenant
 * scoping on the READ path is enforced in the controller from the verified token.
 *
 * Global so the feature module need not re-import this.
 */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: AUTHZ_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AuthzModuleOptions => ({
        // The audit service is not a Cerbos PEP; these endpoints are unused by the
        // middleware but the AuthzModuleOptions contract requires them.
        cerbosUrl: '',
        papUrl: '',
        auditUrl: '',
        // The signature-verification wiring the IdentityContextMiddleware consumes.
        internalTokenSecret: config.values.INTERNAL_TOKEN_SECRET,
        internalTokenIssuer: config.values.INTERNAL_TOKEN_ISSUER,
        internalTokenClockToleranceSeconds:
          config.values.INTERNAL_TOKEN_CLOCK_TOLERANCE_SECONDS,
      }),
    },
    IdentityContextMiddleware,
  ],
  exports: [CLOCK, AUTHZ_OPTIONS, IdentityContextMiddleware],
})
export class SharedModule {}
