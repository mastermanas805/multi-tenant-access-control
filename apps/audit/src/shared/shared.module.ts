import { Global, Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '@kernel/core';

/**
 * Exposes cross-cutting providers shared by the feature module:
 *   - CLOCK port -> SystemClock (use-cases inject CLOCK, never `new Date()`),
 *     so the `decidedAt`/`receivedAt` stamping is deterministic in tests.
 *
 * The audit log is append-only and not tenant-RLS-scoped (it is the compliance
 * system of record, a separate trust boundary — DESIGN §8.7 / App. C), so unlike
 * the OLTP services there is no TenantContextGuard / RlsInterceptor here.
 *
 * Global so the feature module need not re-import this.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class SharedModule {}
