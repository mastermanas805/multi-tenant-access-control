import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

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
  }
}
