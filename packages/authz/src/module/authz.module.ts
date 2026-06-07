import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AUDIT_SINK } from '../audit/audit-sink.port';
import { HttpAuditSink } from '../audit/http-audit.sink';
import { CerbosPdpClient } from '../pdp/cerbos-pdp.client';
import { HttpPipClient } from '../pip/http-pip.client';
import { PIP_CLIENT } from '../pip/pip-client.port';
import { AuthzGuard } from '../pep/authz.guard';
import {
  AUTHZ_OPTIONS,
  type AuthzModuleAsyncOptions,
  type AuthzModuleOptions,
} from './authz.options';

/**
 * The reusable PEP toolkit as a NestJS dynamic module (DESIGN §4). A business
 * service imports `AuthzModule.forRootAsync({...})`, wiring the PDP/PIP/Audit from
 * its own config (CERBOS_URL, PAP_URL, AUDIT_URL). It then attaches `@UseGuards`
 * + `@Authorize` per route, or relies on the optionally-registered global guard.
 *
 * Defaults: HttpPipClient (PIP_CLIENT) + HttpAuditSink (AUDIT_SINK), both
 * overridable via the `pipClient` / `auditSink` provider overrides so a service
 * can supply, e.g., an event-fed local PIP without touching the PEP.
 *
 * The IdentityContextMiddleware is exported separately for the consumer to apply
 * in its AppModule.configure() (middleware can't be applied from a provider).
 */
@Module({})
export class AuthzModule {
  /** Synchronous wiring from a literal options object. */
  public static forRoot(options: AuthzModuleOptions, registerGlobalGuard = false): DynamicModule {
    return AuthzModule.build({ provide: AUTHZ_OPTIONS, useValue: options }, [], registerGlobalGuard);
  }

  /** Async wiring so options come from the service's ConfigService (DESIGN §4.4). */
  public static forRootAsync(
    asyncOptions: AuthzModuleAsyncOptions,
    registerGlobalGuard = false,
  ): DynamicModule {
    const optionsProvider: Provider = {
      provide: AUTHZ_OPTIONS,
      useFactory: asyncOptions.useFactory as (...args: unknown[]) => AuthzModuleOptions,
      inject: (asyncOptions.inject ?? []) as never[],
    };
    return AuthzModule.build(
      optionsProvider,
      (asyncOptions.imports ?? []) as DynamicModule['imports'],
      registerGlobalGuard,
    );
  }

  private static build(
    optionsProvider: Provider,
    imports: DynamicModule['imports'],
    registerGlobalGuard: boolean,
  ): DynamicModule {
    const providers: Provider[] = [
      optionsProvider,
      CerbosPdpClient,
      { provide: PIP_CLIENT, useClass: HttpPipClient },
      { provide: AUDIT_SINK, useClass: HttpAuditSink },
      AuthzGuard,
    ];
    if (registerGlobalGuard) {
      providers.push({ provide: APP_GUARD, useClass: AuthzGuard });
    }
    return {
      module: AuthzModule,
      global: true,
      imports: imports ?? [],
      providers,
      // Export the building blocks so a service can @UseGuards(AuthzGuard) and
      // inject the PDP/PIP/Audit/options directly when needed.
      exports: [AuthzGuard, CerbosPdpClient, PIP_CLIENT, AUDIT_SINK, AUTHZ_OPTIONS],
    };
  }
}
