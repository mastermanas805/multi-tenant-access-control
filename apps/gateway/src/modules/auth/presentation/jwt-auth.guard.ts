import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { type Request } from 'express';

import { resolveRoute } from '../../proxy/domain/route-table';
import { AuthenticateRequestUseCase } from '../application/use-cases/authenticate-request.use-case';

/**
 * Edge authentication gate (DESIGN §4.3 step 1, §4.4 — authN only). Route-aware:
 * it consults the same pure route table the proxy uses and:
 *   - PUBLIC route (e.g. /auth/*): passes through WITHOUT requiring a token (the
 *     user is logging in / refreshing and has no token yet);
 *   - PROTECTED route: verifies the inbound end-user JWT against the Identity
 *     JWKS and attaches the trusted GatewayIdentity to `req.identity`. On ANY
 *     failure the use-case throws UnauthenticatedError -> 401 + §8.1 envelope.
 *   - UNKNOWN route: passes through so the proxy controller renders a clean 404
 *     (rather than leaking auth-vs-not-found to a probe).
 *
 * CRITICAL: this guard is the ONLY thing that may populate `req.identity`. It is
 * derived solely from the cryptographically verified JWT; client-sent identity
 * headers are ignored here and stripped/overwritten downstream (confused-deputy,
 * §7). The gateway performs authN, never authZ — authorization is each service's
 * PEP (§4.4).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authenticate: AuthenticateRequestUseCase) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const route = resolveRoute(request.path);

    // Only protected routes require (and get) a verified identity.
    if (route?.requiresAuth === true) {
      request.identity = await this.authenticate.execute({
        authorizationHeader: request.headers.authorization,
      });
    }
    return true;
  }
}
