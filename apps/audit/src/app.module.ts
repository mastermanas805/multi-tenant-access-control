import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { IdentityContextMiddleware } from '@authz/pep';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { AuditEventModule } from './modules/audit-event/audit-event.module';
import { DatabaseModule } from './shared/infrastructure/database/database.module';
import { GlobalExceptionFilter } from './shared/presentation/global-exception.filter';
import { LoggingInterceptor } from './shared/presentation/logging.interceptor';
import { RequestContextMiddleware } from './shared/presentation/request-context';
import { SharedModule } from './shared/shared.module';

/**
 * Composition root. Order of imports:
 *   ConfigModule  -> typed, validated env (global)
 *   DatabaseModule-> DataSource (global)
 *   SharedModule  -> CLOCK (global)
 *   HealthModule  -> terminus probes
 *   AuditEventModule -> the append-only, hash-chained log
 *
 * Unlike the OLTP services there is NO RlsInterceptor / TenantContextMiddleware:
 * the audit log is the compliance system of record (a separate trust boundary),
 * append-only and not exposed to tenant-scoped query runners (DESIGN §8.7/App. C).
 *
 * Middleware: RequestContextMiddleware assigns a trace id everywhere. The PEP's
 * IdentityContextMiddleware (from @authz/pep, wired via SharedModule's AUTHZ_OPTIONS)
 * VERIFIES the gateway-signed internal token and populates `req.authzPrincipal` for
 * the READ endpoints so the controller scopes the decision log to the caller's
 * verified tenant (DESIGN §6/§7). It is excluded from:
 *   - `/health` (unauthenticated liveness/readiness — orchestrators have no token);
 *   - the append-only INGEST `POST /v1/audit/events`, a separate trust boundary the
 *     PEP's fire-and-forget AuditSink posts to with NO internal identity token
 *     (mTLS/SPIFFE protects it in production — DESIGN §10).
 *
 * GlobalExceptionFilter is bound in main.ts so it can run for filter-level errors.
 */
@Module({
  imports: [ConfigModule, DatabaseModule, SharedModule, HealthModule, AuditEventModule],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    GlobalExceptionFilter,
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    consumer
      .apply(IdentityContextMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        // The append-only ingest POST is a separate trust boundary (mTLS/SPIFFE in
        // prod); the PEP posts to it without an internal identity token.
        { path: 'v1/audit/events', method: RequestMethod.POST },
      )
      .forRoutes('*');
  }
}
