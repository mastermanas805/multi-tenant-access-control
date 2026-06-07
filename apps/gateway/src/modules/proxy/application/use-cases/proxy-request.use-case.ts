import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '@kernel/core';

import {
  type InternalTokenMinter,
  INTERNAL_TOKEN_MINTER,
} from '../../../auth/domain/internal-token-minter.port';
import { UnauthenticatedError } from '../../../../shared/errors/unauthenticated.error';
import { buildForwardedHeaders } from '../../domain/forwarded-headers';
import { resolveRoute } from '../../domain/route-table';
import {
  type UpstreamHttpClient,
  type UpstreamResponse,
  UPSTREAM_HTTP_CLIENT,
} from '../../domain/upstream-http-client.port';
import { type UpstreamRegistry, UPSTREAM_REGISTRY } from '../../domain/upstream-registry.port';
import { ConfigService } from '../../../../config/config.service';
import { type ProxyRequestCommand } from '../dto/proxy.commands';

/**
 * The proxy core (DESIGN §4.1, §4.3, §7). For each request it:
 *   1. resolves the upstream from the path (pure route table); 404 if unknown,
 *   2. enforces the route's auth requirement (a protected route with no verified
 *      identity is 401 — defence in depth behind the guard),
 *   3. for authenticated routes, mints the SIGNED internal identity token from the
 *      verified identity (never from client headers),
 *   4. builds the forwarded header set — stripping hop-by-hop AND every
 *      client-spoofable identity/context header, then injecting the server-derived
 *      identity (confused-deputy defense, §7),
 *   5. forwards to the upstream and returns its response verbatim.
 *
 * The upstream's own 4xx/5xx responses are returned UNCHANGED so the §8.1
 * envelopes minted by the services (e.g. a PEP 403 with reason+decisionId) reach
 * the client intact. Only a true proxy-hop failure becomes a gateway 502/504.
 */
@Injectable()
export class ProxyRequestUseCase {
  constructor(
    @Inject(UPSTREAM_HTTP_CLIENT) private readonly http: UpstreamHttpClient,
    @Inject(UPSTREAM_REGISTRY) private readonly registry: UpstreamRegistry,
    @Inject(INTERNAL_TOKEN_MINTER) private readonly minter: InternalTokenMinter,
    private readonly config: ConfigService,
  ) {}

  public async execute(command: ProxyRequestCommand): Promise<UpstreamResponse> {
    const route = resolveRoute(command.path);
    if (route === null) {
      throw new NotFoundError('No route for the requested path', 'no_route');
    }

    if (route.requiresAuth && command.identity === null) {
      // Should be unreachable behind the guard, but fail-closed regardless (D8).
      throw new UnauthenticatedError('Authentication required', 'missing_identity');
    }

    // Mint the signed internal token ONLY for authenticated forwards. The auth
    // surface (/auth/*) forwards with no identity (the user has no token yet).
    const injected =
      command.identity !== null
        ? (() => {
            const minted = this.minter.mint({
              sub: command.identity.sub,
              tid: command.identity.tid,
              actorId: command.identity.actorId,
              sessionId: command.identity.sessionId,
            });
            return {
              internalIdentity: minted.headerValue,
              internalIdentitySignature: minted.signature,
            };
          })()
        : null;

    const headers = buildForwardedHeaders(command.headers, command.identity, injected);

    const base = this.registry.baseUrl(route.upstream).replace(/\/$/, '');
    const url = `${base}${command.path}${command.queryString ? `?${command.queryString}` : ''}`;

    return this.http.forward({
      url,
      method: command.method,
      headers,
      body: command.body,
      timeoutMs: this.config.values.UPSTREAM_TIMEOUT_MS,
    });
  }
}
