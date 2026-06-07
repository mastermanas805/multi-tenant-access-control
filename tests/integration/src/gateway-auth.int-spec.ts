import request from 'supertest';

import { TENANT_ACME } from './helpers/seed-data';
import {
  GATEWAY_DEMO_USER,
  type GatewayStack,
  startGatewayStack,
} from './helpers/gateway-stack';

/**
 * Gateway authN edge (DESIGN §4.3 step 1, §7). The gateway verifies the end-user
 * RS256 JWT against the Identity JWKS, mints a SIGNED internal identity token, and
 * forwards the SERVER-DERIVED identity — never client-asserted headers. Real
 * Identity IdP issues a real JWT; a tiny echo upstream stands in for the Expense
 * PEP so the forwarded headers are directly observable.
 */
describe('Gateway authN edge (real JWT verification + confused-deputy defense)', () => {
  let stack: GatewayStack;

  beforeAll(async () => {
    stack = await startGatewayStack();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** Logs the demo user in DIRECTLY at the Identity IdP and returns the RS256 JWT. */
  async function login(): Promise<string> {
    const res = await request(stack.identityUrl)
      .post('/v1/auth/token')
      .send({ email: GATEWAY_DEMO_USER.email, password: GATEWAY_DEMO_USER.password });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    return res.body.accessToken as string;
  }

  it('issues a real RS256 JWT carrying the Acme tenant UUID as `tid`', async () => {
    const res = await request(stack.identityUrl)
      .post('/v1/auth/token')
      .send({ email: GATEWAY_DEMO_USER.email, password: GATEWAY_DEMO_USER.password });

    expect(res.status).toBe(200);
    expect(res.body.sub).toBe(GATEWAY_DEMO_USER.id);
    expect(res.body.tid).toBe(TENANT_ACME);
  });

  it('VALID JWT -> 200 and forwards the server-derived identity to the upstream', async () => {
    const token = await login();

    const res = await request(stack.gatewayUrl)
      .get('/v1/expenses')
      .set('authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);

    const echo = stack.lastEcho();
    expect(echo).not.toBeNull();
    // The gateway injected the signed internal identity + the verified tenant.
    expect(echo?.headers['x-internal-identity']).toBeDefined();
    expect(echo?.headers['x-tenant-id']).toBe(TENANT_ACME);
    // The decoded internal token carries the verified sub/tid (not client input).
    const raw = echo?.headers['x-internal-identity'] as string;
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      sub: string;
      tid: string;
    };
    expect(decoded.sub).toBe(GATEWAY_DEMO_USER.id);
    expect(decoded.tid).toBe(TENANT_ACME);
  });

  it('IGNORES a forged x-tenant-id / x-internal-identity — overwrites with the verified JWT (§7)', async () => {
    const token = await login();

    const res = await request(stack.gatewayUrl)
      .get('/v1/expenses')
      .set('authorization', `Bearer ${token}`)
      .set('x-tenant-id', 'bbbbbbbb-0000-4000-8000-000000000002') // forged Globex tenant
      .set('x-internal-identity', 'forged-token')
      .send();

    expect(res.status).toBe(200);
    const echo = stack.lastEcho();
    // The forged values are stripped + replaced with the server-derived ones.
    expect(echo?.headers['x-tenant-id']).toBe(TENANT_ACME);
    expect(echo?.headers['x-internal-identity']).not.toBe('forged-token');
  });

  it('MISSING JWT on a protected route -> 401 at the edge (no upstream hop)', async () => {
    const res = await request(stack.gatewayUrl).get('/v1/expenses').send();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('TAMPERED JWT signature -> 401 at the edge', async () => {
    const token = await login();
    const parts = token.split('.');
    const header = parts[0] ?? '';
    const payload = parts[1] ?? '';
    const tampered = `${header}.${payload}.bad-signature`;

    const res = await request(stack.gatewayUrl)
      .get('/v1/expenses')
      .set('authorization', `Bearer ${tampered}`)
      .send();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('unknown path -> edge 404 (no upstream leak)', async () => {
    const res = await request(stack.gatewayUrl).get('/v1/nonexistent').send();
    expect(res.status).toBe(404);
  });
});
