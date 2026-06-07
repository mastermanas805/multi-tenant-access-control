import { Module } from '@nestjs/common';

import { ProxyRequestUseCase } from './application/use-cases/proxy-request.use-case';
import { UPSTREAM_HTTP_CLIENT } from './domain/upstream-http-client.port';
import { UPSTREAM_REGISTRY } from './domain/upstream-registry.port';
import { ConfigUpstreamRegistry } from './infrastructure/config-upstream-registry';
import { FetchUpstreamHttpClient } from './infrastructure/fetch-upstream-http.client';
import { ProxyController } from './presentation/proxy.controller';

/**
 * The reverse-proxy feature module (DESIGN §4.1). Binds the routing use-case, the
 * catch-all controller, and the two infrastructure adapters (HTTP client +
 * config-driven upstream registry) to their ports. The JwtAuthGuard + internal
 * token minter come from the global AuthModule.
 */
@Module({
  controllers: [ProxyController],
  providers: [
    ProxyRequestUseCase,
    { provide: UPSTREAM_HTTP_CLIENT, useClass: FetchUpstreamHttpClient },
    { provide: UPSTREAM_REGISTRY, useClass: ConfigUpstreamRegistry },
  ],
})
export class ProxyModule {}
