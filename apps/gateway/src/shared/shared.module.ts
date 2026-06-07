import { Global, Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '@kernel/core';

/**
 * Exposes the cross-cutting CLOCK port (use-cases/adapters inject CLOCK, never
 * `new Date()`), so JWKS-cache age, internal-token `iat`/`exp` and rate-limit
 * windows are computed from an injectable clock and unit tests can pin time.
 *
 * Like the identity service, the gateway is stateless (no Postgres / RLS / tenant
 * guards), so this module is deliberately minimal. RequestContextMiddleware and
 * the GlobalExceptionFilter are registered in app.module / main.ts. Global so
 * feature modules need not re-import this.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class SharedModule {}
