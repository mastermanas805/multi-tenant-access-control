import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

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
  }
}
