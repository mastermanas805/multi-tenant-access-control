import { createHmac } from 'node:crypto';

import { type NextFunction, type Request, type Response } from 'express';

import { UnauthenticatedError } from '@kernel/core';
import { type InternalIdentityToken } from '@contracts/core';

import { type AuthzModuleOptions } from '../../module/authz.options';
import { IdentityContextMiddleware } from '../identity-context.middleware';

const SECRET = 'test-internal-token-secret';
const ISSUER = 'api-gateway';

const CLAIMS: InternalIdentityToken = {
  sub: 'riya',
  tid: 'aaaaaaaa-0000-4000-8000-000000000001',
  actorId: 'riya',
  sessionId: 'sess_1',
};

function base64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function encodeClaims(claims: InternalIdentityToken): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
}

/** Mints an HS256 compact JWS over the claims exactly as the gateway minter does. */
function signToken(
  claims: InternalIdentityToken,
  overrides: {
    secret?: string;
    iss?: string;
    expSeconds?: number;
    alg?: string;
    header?: Record<string, unknown>;
    payload?: Record<string, unknown>;
  } = {},
): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = overrides.header ?? { alg: overrides.alg ?? 'HS256', typ: 'JWT', kid: 'gw-test' };
  const payload = overrides.payload ?? {
    ...claims,
    iss: overrides.iss ?? ISSUER,
    iat: nowSeconds,
    exp: overrides.expSeconds ?? nowSeconds + 120,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', overrides.secret ?? SECRET)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

function mockReq(headers: Record<string, string | string[] | undefined>): Request {
  return { headers } as unknown as Request;
}

function run(middleware: IdentityContextMiddleware, req: Request): { calledNext: boolean } {
  let calledNext = false;
  const next: NextFunction = () => {
    calledNext = true;
  };
  middleware.use(req, {} as Response, next);
  return { calledNext };
}

function verifying(overrides: Partial<AuthzModuleOptions> = {}): IdentityContextMiddleware {
  return new IdentityContextMiddleware({
    cerbosUrl: 'localhost:3593',
    papUrl: 'http://pap',
    auditUrl: 'http://audit',
    internalTokenSecret: SECRET,
    internalTokenIssuer: ISSUER,
    ...overrides,
  });
}

function placeholder(): IdentityContextMiddleware {
  return new IdentityContextMiddleware({
    cerbosUrl: 'localhost:3593',
    papUrl: 'http://pap',
    auditUrl: 'http://audit',
    // No internalTokenSecret -> dev/test placeholder mode.
  });
}

describe('IdentityContextMiddleware — production signature verification (DESIGN §7)', () => {
  it('accepts a validly-signed token and populates the principal context from the SIGNED claims', () => {
    const mw = verifying();
    const req = mockReq({
      [IdentityContextMiddleware.TOKEN_HEADER]: encodeClaims(CLAIMS),
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS),
    });

    const { calledNext } = run(mw, req);

    expect(calledNext).toBe(true);
    expect(req.authzPrincipal).toEqual({
      principalId: CLAIMS.sub,
      tenantId: CLAIMS.tid,
      actorId: CLAIMS.actorId,
      sessionId: CLAIMS.sessionId,
      // A token without the claim resolves to a non-admin principal (fail-closed).
      platformAdmin: false,
    });
  });

  it('accepts a signed token even when the plaintext identity header is ABSENT (signature is the source of truth)', () => {
    const mw = verifying();
    const req = mockReq({
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS),
    });

    const { calledNext } = run(mw, req);

    expect(calledNext).toBe(true);
    expect(req.authzPrincipal?.principalId).toBe(CLAIMS.sub);
  });

  it('REJECTS (401) a missing signature header', () => {
    const mw = verifying();
    const req = mockReq({ [IdentityContextMiddleware.TOKEN_HEADER]: encodeClaims(CLAIMS) });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) a signature minted with the WRONG secret (forged token)', () => {
    const mw = verifying();
    const req = mockReq({
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS, {
        secret: 'attacker-secret',
      }),
    });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) a tampered payload (claims changed after signing breaks the MAC)', () => {
    const mw = verifying();
    const valid = signToken(CLAIMS);
    const [header, , signature] = valid.split('.') as [string, string, string];
    const tamperedPayload = base64Url(JSON.stringify({ ...CLAIMS, sub: 'attacker', iss: ISSUER }));
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    const req = mockReq({ [IdentityContextMiddleware.SIGNATURE_HEADER]: tampered });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) an alg=none downgrade (alg-confusion defense)', () => {
    const mw = verifying();
    const req = mockReq({
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS, { alg: 'none' }),
    });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) a token whose iss is not the gateway', () => {
    const mw = verifying();
    const req = mockReq({
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS, { iss: 'evil-issuer' }),
    });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) an expired token (beyond clock-skew tolerance)', () => {
    const mw = verifying({ internalTokenClockToleranceSeconds: 0 });
    const expiredSeconds = Math.floor(Date.now() / 1000) - 600;
    const req = mockReq({
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS, {
        expSeconds: expiredSeconds,
      }),
    });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) a token missing exp', () => {
    const mw = verifying();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const req = mockReq({
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS, {
        payload: { ...CLAIMS, iss: ISSUER, iat: nowSeconds },
      }),
    });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) when the plaintext identity header does NOT match the signed claims (binding check)', () => {
    const mw = verifying();
    const otherClaims: InternalIdentityToken = { ...CLAIMS, sub: 'someone-else' };
    const req = mockReq({
      // Valid signature over CLAIMS, but the (untrusted) plaintext header asserts a
      // different sub — a caller trying to pair a real signature with forged claims.
      [IdentityContextMiddleware.TOKEN_HEADER]: encodeClaims(otherClaims),
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS),
    });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) a malformed (non three-segment) signature', () => {
    const mw = verifying();
    const req = mockReq({ [IdentityContextMiddleware.SIGNATURE_HEADER]: 'not-a-jws' });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('carries the SIGNED platformAdmin claim into the principal context (verified elevation)', () => {
    const mw = verifying();
    const adminClaims: InternalIdentityToken = { ...CLAIMS, platformAdmin: true };
    const req = mockReq({
      [IdentityContextMiddleware.TOKEN_HEADER]: encodeClaims(adminClaims),
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(adminClaims),
    });

    run(mw, req);

    expect(req.authzPrincipal?.platformAdmin).toBe(true);
  });

  it('defaults platformAdmin to FALSE when the signed token omits the claim (fail-closed)', () => {
    const mw = verifying();
    const req = mockReq({
      [IdentityContextMiddleware.TOKEN_HEADER]: encodeClaims(CLAIMS),
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS),
    });

    run(mw, req);

    expect(req.authzPrincipal?.platformAdmin).toBe(false);
  });

  it('REJECTS (401) a header that asserts platformAdmin the SIGNED payload does not carry (no self-elevation)', () => {
    const mw = verifying();
    // Signature is over NON-admin CLAIMS, but the untrusted plaintext header claims admin.
    const forgedHeader: InternalIdentityToken = { ...CLAIMS, platformAdmin: true };
    const req = mockReq({
      [IdentityContextMiddleware.TOKEN_HEADER]: encodeClaims(forgedHeader),
      [IdentityContextMiddleware.SIGNATURE_HEADER]: signToken(CLAIMS),
    });

    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });
});

describe('IdentityContextMiddleware — dev/test placeholder mode (no secret configured)', () => {
  it('decodes the base64url claims header WITHOUT a signature (so the unit/e2e suites pass)', () => {
    const mw = placeholder();
    const req = mockReq({ [IdentityContextMiddleware.TOKEN_HEADER]: encodeClaims(CLAIMS) });

    const { calledNext } = run(mw, req);

    expect(calledNext).toBe(true);
    expect(req.authzPrincipal?.principalId).toBe(CLAIMS.sub);
    expect(req.authzPrincipal?.tenantId).toBe(CLAIMS.tid);
  });

  it('REJECTS (401) a missing identity header even in placeholder mode', () => {
    const mw = placeholder();
    expect(() => run(mw, mockReq({}))).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) a malformed (non-JSON) identity header in placeholder mode', () => {
    const mw = placeholder();
    const req = mockReq({ [IdentityContextMiddleware.TOKEN_HEADER]: 'not-base64url-json' });
    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });

  it('REJECTS (401) a placeholder token missing required claims', () => {
    const mw = placeholder();
    const req = mockReq({
      [IdentityContextMiddleware.TOKEN_HEADER]: base64Url(JSON.stringify({ sub: 'riya' })),
    });
    expect(() => run(mw, req)).toThrow(UnauthenticatedError);
  });
});
