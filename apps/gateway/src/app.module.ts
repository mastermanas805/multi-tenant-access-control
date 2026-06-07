import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProxyModule } from './modules/proxy/proxy.module';
import { RateLimitMiddleware } from './modules/rate-limit/presentation/rate-limit.middleware';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { GlobalExceptionFilter } from './shared/presentation/global-exception.filter';
import { LoggingInterceptor } from './shared/presentation/logging.interceptor';
import { RequestContextMiddleware } from './shared/presentation/request-context';
import { SharedModule } from './shared/shared.module';

/**
 * Composition root for the API Gateway (authN edge — DESIGN §4.1, §4.3, §4.4).
 * Order of imports:
 *   ConfigModule   -> typed, validated env (global)
 *   SharedModule   -> CLOCK port (global)
 *   HealthModule   -> terminus liveness probe
 *   RateLimitModule-> edge fixed-window limiter middleware
 *   AuthModule     -> JWKS verifier + internal-token minter + JwtAuthGuard (global)
 *   ProxyModule    -> route table + catch-all reverse proxy
 *
 * Stateless and DB-free (like the identity service): no DatabaseModule / RLS /
 * tenant guard. The single global LoggingInterceptor adds per-request lines; the
 * GlobalExceptionFilter is bound in main.ts for the §8.1 envelope.
 *
 * Middleware runs in declaration order on every route: trace id first (so logs +
 * the error envelope have a correlation id), then the rate limiter (shed floods
 * before any crypto). Authentication is the route-aware JwtAuthGuard on the proxy
 * controller, so it runs only for protected routes (after middleware).
 */
@Module({
  imports: [ConfigModule, SharedModule, HealthModule, RateLimitModule, AuthModule, ProxyModule],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    GlobalExceptionFilter,
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, RateLimitMiddleware).forRoutes('*');
  }
}
