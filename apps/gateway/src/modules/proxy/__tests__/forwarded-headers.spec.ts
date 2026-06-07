import { type GatewayIdentity } from '../../auth/domain/gateway-identity';
import {
  ACTOR_CONTEXT_HEADER,
  buildForwardedHeaders,
  INTERNAL_IDENTITY_HEADER,
  INTERNAL_IDENTITY_SIGNATURE_HEADER,
  PLATFORM_ADMIN_HEADER,
  TENANT_CONTEXT_HEADER,
} from '../domain/forwarded-headers';

const identity: GatewayIdentity = {
  sub: 'user-1',
  tid: 'acme',
  sessionId: 'sess-1',
  actorId: 'user-1',
  platformAdmin: false,
};

const injected = {
  internalIdentity: 'BASE64URL_JSON',
  internalIdentitySignature: 'h.p.s',
};

describe('buildForwardedHeaders (confused-deputy defense — DESIGN §7)', () => {
  it('injects the server-derived identity headers for an authenticated forward', () => {
    const out = buildForwardedHeaders({ 'content-type': 'application/json' }, identity, injected);
    expect(out[INTERNAL_IDENTITY_HEADER]).toBe('BASE64URL_JSON');
    expect(out[INTERNAL_IDENTITY_SIGNATURE_HEADER]).toBe('h.p.s');
    expect(out[TENANT_CONTEXT_HEADER]).toBe('acme');
    expect(out[ACTOR_CONTEXT_HEADER]).toBe('user-1');
    expect(out['content-type']).toBe('application/json');
  });

  it('STRIPS a client-forged x-tenant-id and overwrites it with the verified tenant', () => {
    const out = buildForwardedHeaders(
      { 'x-tenant-id': 'globex', 'x-actor-id': 'attacker' },
      identity,
      injected,
    );
    expect(out[TENANT_CONTEXT_HEADER]).toBe('acme'); // not 'globex'
    expect(out[ACTOR_CONTEXT_HEADER]).toBe('user-1'); // not 'attacker'
  });

  it('STRIPS a client-forged internal-identity header (cannot self-assert identity)', () => {
    const out = buildForwardedHeaders(
      { 'x-internal-identity': 'forged', 'x-internal-identity-signature': 'forged' },
      identity,
      injected,
    );
    expect(out[INTERNAL_IDENTITY_HEADER]).toBe('BASE64URL_JSON');
    expect(out[INTERNAL_IDENTITY_SIGNATURE_HEADER]).toBe('h.p.s');
  });

  it('STRIPS a client-forged x-platform-admin for a NON-admin identity (no self-elevation, fail-closed)', () => {
    const out = buildForwardedHeaders({ 'x-platform-admin': 'true' }, identity, injected);
    expect(out[PLATFORM_ADMIN_HEADER]).toBeUndefined();
  });

  it('RE-DERIVES x-platform-admin from the verified identity (strips the client value, injects the true one)', () => {
    const adminIdentity: GatewayIdentity = { ...identity, platformAdmin: true };
    // The client forges a (here, coincidentally matching) value; it is stripped and
    // replaced by the server-derived one. A non-admin client could never reach here.
    const out = buildForwardedHeaders({ 'x-platform-admin': 'true' }, adminIdentity, injected);
    expect(out[PLATFORM_ADMIN_HEADER]).toBe('true');
  });

  it('strips spoofable headers regardless of header-name casing', () => {
    const out = buildForwardedHeaders(
      { 'X-Tenant-Id': 'globex', 'X-Internal-Identity': 'forged' },
      identity,
      injected,
    );
    expect(out[TENANT_CONTEXT_HEADER]).toBe('acme');
    expect(out[INTERNAL_IDENTITY_HEADER]).toBe('BASE64URL_JSON');
  });

  it('drops hop-by-hop + framing headers', () => {
    const out = buildForwardedHeaders(
      { connection: 'keep-alive', host: 'gateway', 'content-length': '5', accept: '*/*' },
      identity,
      injected,
    );
    expect(out.connection).toBeUndefined();
    expect(out.host).toBeUndefined();
    expect(out['content-length']).toBeUndefined();
    expect(out.accept).toBe('*/*');
  });

  it('does NOT inject identity for a public (unauthenticated) forward but still strips spoofed headers', () => {
    const out = buildForwardedHeaders(
      { 'x-tenant-id': 'globex', 'content-type': 'application/json' },
      null,
      null,
    );
    expect(out[TENANT_CONTEXT_HEADER]).toBeUndefined();
    expect(out[INTERNAL_IDENTITY_HEADER]).toBeUndefined();
    expect(out['content-type']).toBe('application/json');
  });
});
