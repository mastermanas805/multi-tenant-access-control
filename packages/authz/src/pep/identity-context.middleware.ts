import { Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';

import { type InternalIdentityToken } from '@contracts/core';

import { principalContextFromToken } from './authz-request-context';
import './express-augmentation';

/**
 * Reads the signed INTERNAL identity token and populates `req.authzPrincipal`
 * (DESIGN §4.3 step 1-2, §5, §7). The PEP guard then reads that context.
 *
 * PRODUCTION: the token is a signed JWT minted by the gateway (token-exchange,
 * RFC 8693) and verified here against the gateway's JWKS; mTLS/SPIFFE proves WHICH
 * service is calling (DESIGN §7). The ONE thing to swap for the real deployment is
 * `verifyToken` — replace the header-decode placeholder with signature
 * verification. Plaintext identity headers are NEVER trusted (DESIGN §7).
 *
 * THIS REFERENCE IMPL: a documented placeholder reads a base64url-encoded JSON
 * token from the `x-internal-identity` header so the authorization model is
 * exercisable end-to-end without standing up the IdP.
 */
@Injectable()
export class IdentityContextMiddleware implements NestMiddleware {
  public static readonly TOKEN_HEADER = 'x-internal-identity';

  public use(req: Request, _res: Response, next: NextFunction): void {
    const token = this.verifyToken(req);
    req.authzPrincipal = principalContextFromToken(token);
    next();
  }

  /**
   * Placeholder for verifying the signed internal token. Swap for JWKS signature
   * verification in production (DESIGN §7). Decodes a base64url JSON token here.
   */
  private verifyToken(req: Request): InternalIdentityToken {
    const header = req.headers[IdentityContextMiddleware.TOKEN_HEADER];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw || raw.trim().length === 0) {
      throw new UnauthorizedException(
        `Missing ${IdentityContextMiddleware.TOKEN_HEADER} header (placeholder for the signed internal token)`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed internal identity token');
    }
    if (!this.isValidToken(parsed)) {
      throw new UnauthorizedException('Internal identity token missing required claims');
    }
    return parsed;
  }

  private isValidToken(value: unknown): value is InternalIdentityToken {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const t = value as Record<string, unknown>;
    return (
      typeof t.sub === 'string' &&
      typeof t.tid === 'string' &&
      typeof t.actorId === 'string' &&
      typeof t.sessionId === 'string'
    );
  }
}
