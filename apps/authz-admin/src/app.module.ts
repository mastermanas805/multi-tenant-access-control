import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { IdentityContextMiddleware } from '@authz/pep';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { OrgUnitModule } from './modules/org-unit/org-unit.module';
import { PermissionModule } from './modules/permission/permission.module';
import { PolicyModule } from './modules/policy/policy.module';
import { PrincipalModule } from './modules/principal/principal.module';
import { RoleAssignmentModule } from './modules/role-assignment/role-assignment.module';
import { RoleModule } from './modules/role/role.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { DatabaseModule } from './shared/infrastructure/database/database.module';
import { RlsInterceptor } from './shared/infrastructure/database/rls.interceptor';
import { GlobalExceptionFilter } from './shared/presentation/global-exception.filter';
import { LoggingInterceptor } from './shared/presentation/logging.interceptor';
import { RequestContextMiddleware } from './shared/presentation/request-context';
import { SharedModule } from './shared/shared.module';

/**
 * Composition root. Order of imports:
 *   ConfigModule  -> typed, validated env (global)
 *   DatabaseModule-> DataSource + TenantContextService (global)
 *   SharedModule  -> CLOCK + TenantContextGuard (global)
 *   HealthModule  -> terminus probes
 *   <feature modules> -> e.g. TenantModule (add new modules HERE, one line each)
 *
 * Global APP_INTERCEPTORs: RLS (opens the tenant-scoped tx) then logging.
 * GlobalExceptionFilter is bound in main.ts so it can run for filter-level errors.
 *
 * Middleware: RequestContextMiddleware assigns a trace id everywhere. The PEP's
 * IdentityContextMiddleware (from @authz/pep, wired via SharedModule's AUTHZ_OPTIONS)
 * VERIFIES the gateway-signed internal identity token and populates
 * `req.authzPrincipal` (tenant/actor/platform-admin) for the human-facing IAM
 * surfaces, so the PAP — the IAM control plane — never trusts plaintext identity
 * headers (DESIGN §5, §7). It is excluded from:
 *   - `/health` (unauthenticated liveness/readiness — orchestrators have no token);
 *   - the PIP `/v1/principals/*` endpoint, a TRUSTED service-to-service read the
 *     Expense PEP calls with a `tenantId` QUERY param and NO internal identity token
 *     (it uses PipTenantContextGuard instead, DESIGN §3.2/§6).
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    SharedModule,
    HealthModule,
    // --- Feature modules (replicate the Tenant module pattern) ---
    TenantModule,
    OrgUnitModule,
    PermissionModule,
    PolicyModule,
    RoleModule,
    RoleAssignmentModule,
    PrincipalModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    GlobalExceptionFilter,
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    consumer
      .apply(IdentityContextMiddleware)
      // Health is public; the PIP principal-resolution endpoint is a trusted S2S
      // read with no internal identity token (it binds tenant from its query param).
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'v1/principals/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
