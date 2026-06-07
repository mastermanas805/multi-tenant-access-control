import { createPublicKey, createSign, type KeyObject } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../../config/config.service';
import {
  type AccessTokenClaims,
  type JsonWebKeySet,
  type SignedToken,
  type TokenSigner,
} from '../domain/token-signer.port';

/** base64url-encodes a Buffer or UTF-8 string (no padding, RFC 7515). */
function base64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

/**
 * RS256 token signer + JWKS publisher backed by Node's `crypto`. No external JWT
 * library: a JWS is `base64url(header).base64url(payload).base64url(signature)`
 * with an RSASSA-PKCS1-v1_5 + SHA-256 signature over the signing input.
 *
 * The private key is used ONLY here (server-side); the public key is exported as
 * a JWKS so any relying party can verify without a shared secret (DESIGN §5/§7).
 */
@Injectable()
export class CryptoTokenSigner implements TokenSigner {
  private readonly privateKeyPem: string;
  private readonly publicKey: KeyObject;
  private readonly kid: string;

  constructor(config: ConfigService) {
    this.privateKeyPem = config.jwtPrivateKeyPem;
    this.publicKey = createPublicKey(config.jwtPublicKeyPem);
    this.kid = config.values.JWT_SIGNING_KID;
  }

  public signAccessToken(
    claims: AccessTokenClaims,
    nowSeconds: number,
    ttlSeconds: number,
  ): SignedToken {
    const issuedAt = nowSeconds;
    const expiresAt = nowSeconds + ttlSeconds;

    const header = { alg: 'RS256', typ: 'JWT', kid: this.kid };
    const payload = { ...claims, iat: issuedAt, exp: expiresAt };

    const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
      JSON.stringify(payload),
    )}`;

    const signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(this.privateKeyPem)
      .toString('base64url');

    return { token: `${signingInput}.${signature}`, expiresAt, issuedAt };
  }

  public jwks(): JsonWebKeySet {
    // Export the RSA public components (n, e) as base64url per RFC 7518.
    const jwk = this.publicKey.export({ format: 'jwk' }) as { n?: string; e?: string };
    if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
      throw new Error('Public key is not an RSA key; cannot build JWKS');
    }
    return {
      keys: [
        {
          kty: 'RSA',
          use: 'sig',
          alg: 'RS256',
          kid: this.kid,
          n: jwk.n,
          e: jwk.e,
        },
      ],
    };
  }
}
