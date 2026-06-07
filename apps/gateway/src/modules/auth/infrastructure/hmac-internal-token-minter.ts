import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { type Clock, CLOCK } from '@kernel/core';
import { type InternalIdentityToken } from '@contracts/core';

import { ConfigService } from '../../../config/config.service';
import {
  type InternalTokenMinter,
  type MintedInternalToken,
} from '../domain/internal-token-minter.port';

/** base64url-encodes a Buffer or UTF-8 string (no padding, RFC 7515). */
function base64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

/**
 * Mints the signed internal identity token from the verified end-user identity
 * (DESIGN §4.3 step 1, §5, §7). Produces TWO artifacts:
 *
 *   - `headerValue`: base64url(JSON(InternalIdentityToken)) — exactly what the
 *     downstream PEP's IdentityContextMiddleware decodes TODAY (`x-internal-identity`).
 *   - `signature`:   an HS256 compact JWS over the same claims (`x-internal-identity
 *     -signature`) — the token-exchange artifact (RFC 8693) the PEP verifies once
 *     its placeholder `verifyToken` is upgraded to signature checking.
 *
 * HMAC (shared secret) is the reference-impl simplification; production swaps to
 * an asymmetric key the PEPs verify via the gateway's JWKS. The signing key is
 * config-driven and MUST be overridden in production (DESIGN §7). Crypto stays
 * behind this adapter — the domain/application never see a key.
 */
@Injectable()
export class HmacInternalTokenMinter implements InternalTokenMinter {
  private readonly secret: string;
  private readonly kid: string;
  private readonly issuer: string;
  private readonly ttlSeconds: number;

  constructor(
    config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.secret = config.values.INTERNAL_TOKEN_SECRET;
    this.kid = config.values.INTERNAL_TOKEN_KID;
    this.issuer = config.values.INTERNAL_TOKEN_ISSUER;
    this.ttlSeconds = config.values.INTERNAL_TOKEN_TTL_SECONDS;
  }

  public mint(claims: InternalIdentityToken): MintedInternalToken {
    // The header value is the canonical claims, base64url(JSON) — what the PEP
    // decodes today. Carries identity+tenant only (no permissions, D4).
    const headerValue = base64Url(JSON.stringify(claims));

    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const jwsHeader = { alg: 'HS256', typ: 'JWT', kid: this.kid };
    const jwsPayload = {
      ...claims,
      iss: this.issuer,
      iat: nowSeconds,
      exp: nowSeconds + this.ttlSeconds,
    };
    const signingInput = `${base64Url(JSON.stringify(jwsHeader))}.${base64Url(
      JSON.stringify(jwsPayload),
    )}`;
    const signature = createHmac('sha256', this.secret).update(signingInput).digest('base64url');

    return { claims, headerValue, signature: `${signingInput}.${signature}` };
  }
}
