import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../../app.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import {
  INTERNAL_IDENTITY_HEADER,
  INTERNAL_IDENTITY_SIGNATURE_HEADER,
  TENANT_CONTEXT_HEADER,
} from '../domain/forwarded-headers';
import {
  type UpstreamHttpClient,
  type UpstreamRequest,
  type UpstreamResponse,
  UPSTREAM_HTTP_CLIENT,
} from '../domain/upstream-http-client.port';

const KID = 'e2e-kid';
const ISSUER = 'http://localhost:3200';
const AUDIENCE = 'authz-platform';

function base64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** Capturing fake so the e2e never hits a real upstream; records the forward. */
class CapturingUpstreamClient implements UpstreamHttpClient {
  public lastRequest: UpstreamRequest | null = null;

  public forward(request: UpstreamRequest): Promise<UpstreamResponse> {
    this.lastRequest = request;
    return Promise.resolve({
      status: 200,
      headers: { 'content-type': 'application/json', 'x-upstream': 'true' },
      body: Buffer.from(JSON.stringify({ ok: true })),
    });
  }
}

/**
 * Full HTTP stack: real RequestContext + RateLimit middleware, real route-aware
 * JwtAuthGuard, real JwksTokenVerifier (against a stubbed JWKS fetch), real
 * minter + header policy. Only the network-touching UPSTREAM_HTTP_CLIENT is
 * faked, so we can assert exactly what the gateway WOULD forward (DESIGN §4.3/§7).
 */
describe('API Gateway (e2e)', () => {
  let app: INestApplication;
  let upstream: CapturingUpstreamClient;
  let privateKey: KeyObject;

  function signJwt(
    claims: Record<string, unknown>,
    header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT', kid: KID },
  ): string {
    const input = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
    const sig = createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url');
    return `${input}.${sig}`;
  }

  function validToken(overrides: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    return signJwt({
      sub: 'user-1',
      tid: 'acme',
      sid: 'sess-1',
      act: 'user-1',
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now - 5,
      exp: now + 900,
      ...overrides,
    });
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.IDENTITY_ISSUER = ISSUER;
    process.env.IDENTITY_AUDIENCE = AUDIENCE;
    process.env.IDENTITY_JWKS_URL = 'http://identity/.well-known/jwks.json';
    // Generous limit so functional cases are not throttled.
    process.env.RATE_LIMIT_MAX = '1000';

    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    const jwk = pair.publicKey.export({ format: 'jwk' });
    const publicJwk = { ...jwk, kty: 'RSA', use: 'sig', alg: 'RS256', kid: KID };

    // Stub the JWKS fetch the verifier performs (no real identity service).
    (globalThis as { fetch: unknown }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ keys: [publicJwk] }) });

    upstream = new CapturingUpstreamClient();

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UPSTREAM_HTTP_CLIENT)
      .useValue(upstream)
      .compile();

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
    delete process.env.IDENTITY_ISSUER;
    delete process.env.IDENTITY_AUDIENCE;
    delete process.env.IDENTITY_JWKS_URL;
    delete process.env.RATE_LIMIT_MAX;
  });

  it('serves the liveness probe at /health (version-neutral)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('a VALID JWT passes and forwards the server-derived identity context downstream', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/expenses/42/approve')
      .set('Authorization', `Bearer ${validToken()}`)
      .send({ comment: 'ok' })
      .expect(200);

    expect(res.body.ok).toBe(true);

    const fwd = upstream.lastRequest;
    expect(fwd?.url).toBe('http://expense:3300/v1/expenses/42/approve');
    expect(fwd?.method).toBe('POST');
    // The signed internal token + context headers are injected from the JWT.
    expect(fwd?.headers[TENANT_CONTEXT_HEADER]).toBe('acme');
    expect(fwd?.headers['x-actor-id']).toBe('user-1');
    expect(typeof fwd?.headers[INTERNAL_IDENTITY_HEADER]).toBe('string');
    expect(typeof fwd?.headers[INTERNAL_IDENTITY_SIGNATURE_HEADER]).toBe('string');

    // The internal-identity header is base64url(JSON(InternalIdentityToken)) —
    // exactly what the downstream PEP decodes. Round-trip it.
    const decoded = JSON.parse(
      Buffer.from(fwd?.headers[INTERNAL_IDENTITY_HEADER] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(decoded).toEqual({
      sub: 'user-1',
      tid: 'acme',
      actorId: 'user-1',
      sessionId: 'sess-1',
    });
  });

  it('IGNORES client-forged identity/tenant headers — overwrites with the verified JWT (confused-deputy, §7)', async () => {
    await request(app.getHttpServer())
      .get('/v1/expenses')
      .set('Authorization', `Bearer ${validToken()}`)
      .set('x-tenant-id', 'globex')
      .set('x-actor-id', 'attacker')
      .set('x-internal-identity', 'forged-token')
      .set('x-platform-admin', 'true')
      .expect(200);

    const fwd = upstream.lastRequest;
    expect(fwd?.headers[TENANT_CONTEXT_HEADER]).toBe('acme'); // NOT 'globex'
    expect(fwd?.headers['x-actor-id']).toBe('user-1'); // NOT 'attacker'
    expect(fwd?.headers[INTERNAL_IDENTITY_HEADER]).not.toBe('forged-token');
    expect(fwd?.headers['x-platform-admin']).toBeUndefined(); // self-elevation stripped
  });

  it('a MISSING JWT on a protected route is 401 + §8.1 envelope', async () => {
    const res = await request(app.getHttpServer()).get('/v1/expenses').expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
    expect(res.body.error.traceId).toBeDefined();
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('an INVALID (tampered) JWT is 401', async () => {
    const token = validToken();
    const [h, , s] = token.split('.') as [string, string, string];
    const tampered = `${h}.${base64Url(JSON.stringify({ sub: 'x', tid: 'globex', sid: 's', exp: 9_999_999_999 }))}.${s}`;
    const res = await request(app.getHttpServer())
      .get('/v1/expenses')
      .set('Authorization', `Bearer ${tampered}`)
      .expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('an EXPIRED JWT is 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/expenses')
      .set('Authorization', `Bearer ${validToken({ exp: Math.floor(Date.now() / 1000) - 5000 })}`)
      .expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('forwards /auth/* PUBLICLY (no token required, no identity injected)', async () => {
    await request(app.getHttpServer())
      .post('/auth/token')
      .send({ email: 'riya@acme.com', password: 'Password123!' })
      .expect(200);

    const fwd = upstream.lastRequest;
    expect(fwd?.url).toBe('http://identity:3200/auth/token');
    expect(fwd?.headers[INTERNAL_IDENTITY_HEADER]).toBeUndefined();
    expect(fwd?.headers[TENANT_CONTEXT_HEADER]).toBeUndefined();
  });

  it('routes IAM collections to authz-admin with identity injected', async () => {
    await request(app.getHttpServer())
      .get('/v1/policies?limit=5')
      .set('Authorization', `Bearer ${validToken()}`)
      .expect(200);

    expect(upstream.lastRequest?.url).toBe('http://authz-admin:3000/v1/policies?limit=5');
    expect(upstream.lastRequest?.headers[TENANT_CONTEXT_HEADER]).toBe('acme');
  });

  it('returns 404 for an unroutable path', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/payroll')
      .set('Authorization', `Bearer ${validToken()}`)
      .expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('enforces rate limiting with a 429 + §8.1 envelope', async () => {
    process.env.RATE_LIMIT_MAX = '2';
    const limitedModule: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UPSTREAM_HTTP_CLIENT)
      .useValue(new CapturingUpstreamClient())
      .compile();
    const limitedApp = limitedModule.createNestApplication();
    limitedApp.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    limitedApp.useGlobalFilters(limitedApp.get(GlobalExceptionFilter));
    await limitedApp.init();

    const server = limitedApp.getHttpServer();
    await request(server).get('/health').expect(200);
    await request(server).get('/health').expect(200);
    const limited = await request(server).get('/health').expect(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBeDefined();

    await limitedApp.close();
    process.env.RATE_LIMIT_MAX = '1000';
  });
});
