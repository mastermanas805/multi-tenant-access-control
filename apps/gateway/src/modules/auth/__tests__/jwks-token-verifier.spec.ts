import {
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';

import { type Clock } from '@kernel/core';

import { ConfigService } from '../../../config/config.service';
import { UnauthenticatedError } from '../../../shared/errors/unauthenticated.error';
import { BearerToken } from '../domain/value-objects/bearer-token.vo';
import { JwksTokenVerifier } from '../infrastructure/jwks-token-verifier';

const KID = 'test-kid';
const ISSUER = 'http://localhost:3200';
const AUDIENCE = 'authz-platform';

function base64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

const fixedClock: Clock = { now: () => new Date(1_000_000 * 1000) };

/** Builds a verifier wired to the in-test keypair's JWKS via a stubbed fetch. */
function setup(): { verifier: JwksTokenVerifier; privateKey: KeyObject; publicJwk: object } {
  process.env.NODE_ENV = 'test';
  process.env.IDENTITY_ISSUER = ISSUER;
  process.env.IDENTITY_AUDIENCE = AUDIENCE;
  process.env.IDENTITY_JWKS_URL = 'http://identity/.well-known/jwks.json';

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const publicJwk = { ...jwk, kty: 'RSA', use: 'sig', alg: 'RS256', kid: KID };

  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ keys: [publicJwk] }),
  });
  (globalThis as { fetch: unknown }).fetch = fetchMock;

  const verifier = new JwksTokenVerifier(new ConfigService(), fixedClock);
  return { verifier, privateKey, publicJwk };
}

function signJwt(
  privateKey: KeyObject,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT', kid: KID },
): string {
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

const NOW = 1_000_000;
const validClaims = {
  sub: 'user-1',
  tid: 'acme',
  sid: 'sess-1',
  act: 'user-1',
  iss: ISSUER,
  aud: AUDIENCE,
  iat: NOW - 10,
  exp: NOW + 900,
};

describe('JwksTokenVerifier (DESIGN §4.3/§5/§7)', () => {
  afterEach(() => {
    delete process.env.IDENTITY_ISSUER;
    delete process.env.IDENTITY_AUDIENCE;
    delete process.env.IDENTITY_JWKS_URL;
  });

  it('verifies a valid RS256 token and returns its claims', async () => {
    const { verifier, privateKey } = setup();
    const claims = await verifier.verify(
      BearerToken.fromAuthorizationHeader(`Bearer ${signJwt(privateKey, validClaims)}`),
    );
    expect(claims.sub).toBe('user-1');
    expect(claims.tid).toBe('acme');
    expect(claims.sid).toBe('sess-1');
    expect(claims.act).toBe('user-1');
  });

  it('rejects a token with a tampered payload (signature mismatch)', async () => {
    const { verifier, privateKey } = setup();
    const token = signJwt(privateKey, validClaims);
    const [h, , s] = token.split('.') as [string, string, string];
    const tampered = `${h}.${base64Url(JSON.stringify({ ...validClaims, tid: 'globex' }))}.${s}`;
    await expect(
      verifier.verify(BearerToken.fromAuthorizationHeader(`Bearer ${tampered}`)),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects an expired token', async () => {
    const { verifier, privateKey } = setup();
    const token = signJwt(privateKey, { ...validClaims, exp: NOW - 1000 });
    await expect(
      verifier.verify(BearerToken.fromAuthorizationHeader(`Bearer ${token}`)),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects a wrong issuer and a wrong audience', async () => {
    const { verifier, privateKey } = setup();
    await expect(
      verifier.verify(
        BearerToken.fromAuthorizationHeader(`Bearer ${signJwt(privateKey, { ...validClaims, iss: 'evil' })}`),
      ),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      verifier.verify(
        BearerToken.fromAuthorizationHeader(`Bearer ${signJwt(privateKey, { ...validClaims, aud: 'other' })}`),
      ),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects an alg:none / unsupported-alg token (downgrade attack)', async () => {
    const { verifier, privateKey } = setup();
    const token = signJwt(privateKey, validClaims, { alg: 'none', typ: 'JWT', kid: KID });
    await expect(
      verifier.verify(BearerToken.fromAuthorizationHeader(`Bearer ${token}`)),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects a token signed by an unknown key (kid not in JWKS)', async () => {
    const { verifier, privateKey } = setup();
    const token = signJwt(privateKey, validClaims, { alg: 'RS256', typ: 'JWT', kid: 'other-kid' });
    await expect(
      verifier.verify(BearerToken.fromAuthorizationHeader(`Bearer ${token}`)),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
