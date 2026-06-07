import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { GlobalExceptionFilter } from './shared/presentation/global-exception.filter';
import { LoggingInterceptor } from './shared/presentation/logging.interceptor';
import { RequestContextMiddleware } from './shared/presentation/request-context';
import { SharedModule } from './shared/shared.module';

/**
 * Composition root for the Identity service (OIDC-style IdP). Order of imports:
 *   ConfigModule  -> typed, validated env + keypair/seed resolution (global)
 *   SharedModule  -> CLOCK port (global)
 *   HealthModule  -> terminus liveness probe
 *   IdentityModule-> auth/token + JWKS endpoints
 *
 * Stateless and DB-free (config-seeded users), so there is no DatabaseModule /
 * RlsInterceptor / tenant guard here — that is the deliberate difference from the
 * authz-admin PAP. The single global LoggingInterceptor adds per-request lines;
 * the GlobalExceptionFilter is bound in main.ts for the §8.1 envelope.
 */
@Module({
  imports: [ConfigModule, SharedModule, HealthModule, IdentityModule],
  providers: [{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }, GlobalExceptionFilter],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
