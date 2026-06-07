import { Global, Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '@kernel/core';

/**
 * Exposes cross-cutting providers shared by all feature modules:
 *   - CLOCK port -> SystemClock (use-cases inject CLOCK, never `new Date()`),
 *     so token `iat`/`exp` are computed from an injectable clock and unit tests
 *     can pin time.
 *
 * Unlike the PAP, the identity service is config-seeded (no Postgres / RLS /
 * tenant guards), so this module is deliberately minimal. The RequestContext-
 * Middleware and GlobalExceptionFilter are registered in app.module / main.ts.
 * Global so feature modules need not re-import this.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class SharedModule {}
