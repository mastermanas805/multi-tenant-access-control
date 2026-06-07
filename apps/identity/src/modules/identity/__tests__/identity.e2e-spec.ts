import { createPublicKey, createVerify } from 'node:crypto';

import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../../app.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';

/**
 * Full HTTP -> use-case -> crypto stack, no mocks. Boots the real AppModule:
 * the dev keypair under keys/ is loaded and the demo users (riya/sam/dev) are
 * seeded + hashed at init. Proves end-to-end token issuance, JWKS publishing,
 * cross-key signature verification, the §8.1 error envelope, and refresh rotation.
 */
describe('Identity service (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(app.get(GlobalExceptionFilter));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Splits a compact JWS into its three string segments (asserts the shape). */
  function jwtParts(token: string): [string, string, string] {
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    return parts as [string, string, string];
  }

  function decodeJwtPayload(token: string): Record<string, unknown> {
    const [, payloadB64] = jwtParts(token);
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  }

  it('publishes a JWKS at /.well-known/jwks.json (version-neutral, no /v1)', async () => {
    const res = await request(app.getHttpServer()).get('/.well-known/jwks.json').expect(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0]).toMatchObject({ kty: 'RSA', use: 'sig', alg: 'RS256' });
    expect(typeof res.body.keys[0].kid).toBe('string');
    expect(typeof res.body.keys[0].n).toBe('string');
    expect(res.headers['cache-control']).toContain('max-age');
  });

  it('issues a token whose signature verifies against the published JWKS', async () => {
    const tokenRes = await request(app.getHttpServer())
      .post('/v1/auth/token')
      .send({ email: 'riya@acme.com', password: 'Password123!' })
      .expect(200);

    expect(tokenRes.body.tokenType).toBe('Bearer');
    expect(tokenRes.body.expiresIn).toBe(900);
    expect(typeof tokenRes.body.accessToken).toBe('string');
    expect(typeof tokenRes.body.refreshToken).toBe('string');
    expect(tokenRes.headers['cache-control']).toBe('no-store');

    // Claims: IDENTITY + TENANT only, NO roles/permissions (D4).
    const accessToken = tokenRes.body.accessToken as string;
    const payload = decodeJwtPayload(accessToken);
    expect(payload.tid).toBe('acme');
    expect(payload.sub).toBe(tokenRes.body.sub);
    expect(payload.sid).toBe(tokenRes.body.sid);
    expect(payload.act).toBe(payload.sub);
    expect(payload.aud).toBe('authz-platform');
    expect(typeof payload.exp).toBe('number');
    expect(payload).not.toHaveProperty('roles');
    expect(payload).not.toHaveProperty('permissions');

    // Verify the RS256 signature using the published JWKS public key.
    const jwksRes = await request(app.getHttpServer()).get('/.well-known/jwks.json').expect(200);
    const jwk = jwksRes.body.keys[0];
    const pubKey = createPublicKey({ key: jwk, format: 'jwk' });
    const [h, p, s] = jwtParts(accessToken);
    const ok = createVerify('RSA-SHA256')
      .update(`${h}.${p}`)
      .verify(pubKey, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });

  it('rejects invalid credentials with 401 + the §8.1 envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/token')
      .send({ email: 'riya@acme.com', password: 'wrong-password' })
      .expect(401);

    expect(res.body.error.code).toBe('unauthenticated');
    expect(res.body.error.message).toBe('Invalid email or password');
    expect(res.headers['x-trace-id']).toBeDefined();
    expect(res.body.error.traceId).toBeDefined();
  });

  it('rejects an unknown user with the SAME 401 message (no enumeration)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/token')
      .send({ email: 'ghost@acme.com', password: 'whatever' })
      .expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('returns 400 + validation envelope for a malformed request body', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/token')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rotates a refresh token (single-use) and rejects replay', async () => {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/token')
      .send({ email: 'sam@acme.com', password: 'Password123!' })
      .expect(200);

    const refreshToken = login.body.refreshToken as string;
    const sid = login.body.sid as string;

    const refreshed = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    // The refresh token ROTATED to a fresh random value (single-use).
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);
    // A valid new access token was minted (3-segment JWT) for the same user.
    expect((refreshed.body.accessToken as string).split('.')).toHaveLength(3);
    expect(decodeJwtPayload(refreshed.body.accessToken as string).sub).toBe(login.body.sub);
    // Session id survives rotation.
    expect(refreshed.body.sid).toBe(sid);

    // Replaying the consumed token is rejected (rotation defense).
    const replay = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe('unauthenticated');
  });

  it('serves the liveness probe at /health (version-neutral)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});
