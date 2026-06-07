import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';

import { type ConfigService } from '../../../config/config.service';
import { CryptoTokenSigner } from '../infrastructure/crypto-token-signer';
import { type AccessTokenClaims } from '../domain/token-signer.port';

/** Splits a compact JWS into its three string segments (asserts the shape). */
function jwtParts(token: string): [string, string, string] {
  const parts = token.split('.');
  expect(parts).toHaveLength(3);
  const [header, payload, signature] = parts as [string, string, string];
  return [header, payload, signature];
}

/**
 * Proves the RS256 signer produces a JWT that verifies against the public key,
 * and that the JWKS publishes a usable RSA key — the load-bearing crypto.
 */
describe('CryptoTokenSigner', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const KID = 'test-kid-1';

  // Minimal ConfigService stand-in exposing only what the signer reads.
  const config = {
    jwtPrivateKeyPem: privatePem,
    jwtPublicKeyPem: publicPem,
    values: { JWT_SIGNING_KID: KID },
  } as unknown as ConfigService;

  const signer = new CryptoTokenSigner(config);

  const claims: AccessTokenClaims = {
    sub: '11111111-1111-4111-8111-111111111111',
    tid: 'acme',
    sid: 'sid_abc',
    act: '11111111-1111-4111-8111-111111111111',
    iss: 'http://localhost:3100',
    aud: 'authz-platform',
  };

  it('signs a JWT whose signature verifies against the public key', () => {
    const nowSeconds = 1_000_000;
    const { token, issuedAt, expiresAt } = signer.signAccessToken(claims, nowSeconds, 900);

    const [headerB64, payloadB64, signatureB64] = jwtParts(token);

    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    expect(header).toStrictEqual({ alg: 'RS256', typ: 'JWT', kid: KID });

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    expect(payload).toMatchObject(claims);
    expect(payload.iat).toBe(nowSeconds);
    expect(payload.exp).toBe(nowSeconds + 900);
    expect(issuedAt).toBe(nowSeconds);
    expect(expiresAt).toBe(nowSeconds + 900);

    const verified = createVerify('RSA-SHA256')
      .update(`${headerB64}.${payloadB64}`)
      .verify(publicPem, Buffer.from(signatureB64, 'base64url'));
    expect(verified).toBe(true);
  });

  it('detects a tampered payload (signature no longer verifies)', () => {
    const { token } = signer.signAccessToken(claims, 1_000_000, 900);
    const [headerB64, , signatureB64] = jwtParts(token);
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...claims, tid: 'globex', iat: 1, exp: 9 }),
    ).toString('base64url');

    const verified = createVerify('RSA-SHA256')
      .update(`${headerB64}.${forgedPayload}`)
      .verify(publicPem, Buffer.from(signatureB64, 'base64url'));
    expect(verified).toBe(false);
  });

  it('publishes a JWKS whose key reconstructs the signing public key', () => {
    const jwks = signer.jwks();
    expect(jwks.keys).toHaveLength(1);
    const jwk = jwks.keys[0];
    expect(jwk).toMatchObject({ kty: 'RSA', use: 'sig', alg: 'RS256', kid: KID });

    // The JWK must rebuild into the same public key (same modulus/exponent).
    const fromJwk = createPublicKey({ key: jwk, format: 'jwk' });
    const exported = fromJwk.export({ format: 'jwk' }) as { n?: string; e?: string };
    const original = publicKey.export({ format: 'jwk' }) as { n?: string; e?: string };
    expect(exported.n).toBe(original.n);
    expect(exported.e).toBe(original.e);
  });
});
