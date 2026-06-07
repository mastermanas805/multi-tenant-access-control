import { NotFoundError } from '@kernel/core';
import { type InternalIdentityToken } from '@contracts/core';

import { type GatewayIdentity } from '../../auth/domain/gateway-identity';
import {
  type InternalTokenMinter,
  type MintedInternalToken,
} from '../../auth/domain/internal-token-minter.port';
import { ConfigService } from '../../../config/config.service';
import { ProxyRequestUseCase } from '../application/use-cases/proxy-request.use-case';
import {
  INTERNAL_IDENTITY_HEADER,
  TENANT_CONTEXT_HEADER,
} from '../domain/forwarded-headers';
import {
  type UpstreamHttpClient,
  type UpstreamRequest,
  type UpstreamResponse,
} from '../domain/upstream-http-client.port';
import { type UpstreamRegistry } from '../domain/upstream-registry.port';
import { type UpstreamName } from '../domain/upstream';

class FakeUpstreamClient implements UpstreamHttpClient {
  public lastRequest: UpstreamRequest | null = null;
  public response: UpstreamResponse = { status: 200, headers: {}, body: Buffer.from('ok') };

  public forward(request: UpstreamRequest): Promise<UpstreamResponse> {
    this.lastRequest = request;
    return Promise.resolve(this.response);
  }
}

class FakeRegistry implements UpstreamRegistry {
  public baseUrl(upstream: UpstreamName): string {
    return `http://${upstream}.svc`;
  }
}

class FakeMinter implements InternalTokenMinter {
  public mint(claims: InternalIdentityToken): MintedInternalToken {
    return {
      claims,
      headerValue: `mock(${claims.sub}/${claims.tid})`,
      signature: 'mock.jws.sig',
    };
  }
}

const identity: GatewayIdentity = {
  sub: 'user-1',
  tid: 'acme',
  sessionId: 'sess-1',
  actorId: 'user-1',
};

function makeUseCase(client: FakeUpstreamClient): ProxyRequestUseCase {
  process.env.NODE_ENV = 'test';
  return new ProxyRequestUseCase(client, new FakeRegistry(), new FakeMinter(), new ConfigService());
}

describe('ProxyRequestUseCase (DESIGN §4.1/§4.3/§7)', () => {
  it('routes an authenticated /v1/expenses request to the expense upstream with injected identity', async () => {
    const client = new FakeUpstreamClient();
    const useCase = makeUseCase(client);

    await useCase.execute({
      path: '/v1/expenses/42/approve',
      queryString: '',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{}'),
      identity,
    });

    const req = client.lastRequest;
    expect(req).not.toBeNull();
    expect(req?.url).toBe('http://expense.svc/v1/expenses/42/approve');
    expect(req?.method).toBe('POST');
    expect(req?.headers[INTERNAL_IDENTITY_HEADER]).toBe('mock(user-1/acme)');
    expect(req?.headers['x-internal-identity-signature']).toBe('mock.jws.sig');
    expect(req?.headers[TENANT_CONTEXT_HEADER]).toBe('acme');
    expect(req?.headers['x-actor-id']).toBe('user-1');
  });

  it('OVERWRITES a client-forged x-tenant-id with the verified tenant (confused-deputy)', async () => {
    const client = new FakeUpstreamClient();
    const useCase = makeUseCase(client);

    await useCase.execute({
      path: '/v1/expenses',
      queryString: '',
      method: 'GET',
      headers: { 'x-tenant-id': 'globex', 'x-internal-identity': 'forged' },
      body: undefined,
      identity,
    });

    expect(client.lastRequest?.headers[TENANT_CONTEXT_HEADER]).toBe('acme');
    expect(client.lastRequest?.headers[INTERNAL_IDENTITY_HEADER]).toBe('mock(user-1/acme)');
  });

  it('forwards /auth/* to identity WITHOUT minting/injecting identity (public route)', async () => {
    const client = new FakeUpstreamClient();
    const useCase = makeUseCase(client);

    await useCase.execute({
      path: '/auth/token',
      queryString: '',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"email":"x"}'),
      identity: null,
    });

    expect(client.lastRequest?.url).toBe('http://identity.svc/auth/token');
    expect(client.lastRequest?.headers[INTERNAL_IDENTITY_HEADER]).toBeUndefined();
    expect(client.lastRequest?.headers[TENANT_CONTEXT_HEADER]).toBeUndefined();
  });

  it('routes IAM collections to authz-admin and preserves the query string', async () => {
    const client = new FakeUpstreamClient();
    const useCase = makeUseCase(client);

    await useCase.execute({
      path: '/v1/policies',
      queryString: 'limit=10&cursor=abc',
      method: 'GET',
      headers: {},
      body: undefined,
      identity,
    });

    expect(client.lastRequest?.url).toBe('http://authz-admin.svc/v1/policies?limit=10&cursor=abc');
  });

  it('returns the upstream response verbatim (status + body), including a 4xx', async () => {
    const client = new FakeUpstreamClient();
    client.response = {
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"error":{"code":"forbidden"}}'),
    };
    const useCase = makeUseCase(client);

    const res = await useCase.execute({
      path: '/v1/expenses/42/approve',
      queryString: '',
      method: 'POST',
      headers: {},
      body: Buffer.from('{}'),
      identity,
    });

    expect(res.status).toBe(403);
    expect(res.body.toString()).toContain('forbidden');
  });

  it('throws NotFoundError for an unroutable path', async () => {
    const client = new FakeUpstreamClient();
    const useCase = makeUseCase(client);

    await expect(
      useCase.execute({
        path: '/v1/payroll',
        queryString: '',
        method: 'GET',
        headers: {},
        body: undefined,
        identity,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
