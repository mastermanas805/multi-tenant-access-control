import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuthzModule, IdentityContextMiddleware } from '@authz/pep';

import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { HealthModule } from './health/health.module';
import { ExpenseModule } from './modules/expense/expense.module';
import { DatabaseModule } from './shared/infrastructure/database/database.module';
import { RlsInterceptor } from './shared/infrastructure/database/rls.interceptor';
import { GlobalExceptionFilter } from './shared/presentation/global-exception.filter';
import { LoggingInterceptor } from './shared/presentation/logging.interceptor';
import { RequestContextMiddleware } from './shared/presentation/request-context';
import { SharedModule } from './shared/shared.module';

/**
 * Composition root for the Expense (PEP) service. Order of imports:
 *   ConfigModule   -> typed, validated env (global)
 *   DatabaseModule -> DataSource + TenantContextService (global)
 *   SharedModule   -> CLOCK + DOMAIN_EVENT_DISPATCHER + IdentityTenantContextGuard (global)
 *   HealthModule   -> terminus probes
 *   AuthzModule    -> the reusable PEP toolkit (PDP/PIP/Audit), wired from config
 *                     (CERBOS_URL/PAP_URL/AUDIT_URL). `global:true`, so the guard +
 *                     clients are available to ExpenseModule (DESIGN §4).
 *   ExpenseModule  -> the worked PEP example (approve + authorization-aware list)
 *
 * Global APP_INTERCEPTORs: RLS (opens the tenant-scoped tx) then logging.
 * GlobalExceptionFilter is bound in main.ts so it can run for filter-level errors.
 *
 * Middleware: RequestContextMiddleware assigns a trace id; IdentityContextMiddleware
 * (from @authz/pep) verifies the internal identity token and populates
 * `req.authzPrincipal` for every route (DESIGN §4.3 step 1-2).
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    SharedModule,
    HealthModule,
    AuthzModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        cerbosUrl: config.values.CERBOS_URL,
        papUrl: config.values.PAP_URL,
        auditUrl: config.values.AUDIT_URL,
        pipCacheTtlMs: 5000,
        pipCacheMaxEntries: 10000,
      }),
    }),
    ExpenseModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    GlobalExceptionFilter,
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    // RequestContextMiddleware (trace id) runs everywhere. The
    // IdentityContextMiddleware requires the internal identity token, so it must
    // NOT gate the version-neutral, UNAUTHENTICATED liveness/readiness probe at
    // `/health` (orchestrators have no token) — exclude it (DESIGN §8: health is
    // version-neutral + public). All /v1/* business routes still run behind it.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    consumer
      .apply(IdentityContextMiddleware)
      .exclude({ path: 'health', method: RequestMethod.ALL })
      .forRoutes('*');
  }
}
