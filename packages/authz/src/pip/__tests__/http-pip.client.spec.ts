import { type EffectivePrincipal } from '@contracts/core';

import { type AuthzModuleOptions } from '../../module/authz.options';
import { HttpPipClient } from '../http-pip.client';

const OPTIONS: AuthzModuleOptions = {
  cerbosUrl: 'localhost:3593',
  papUrl: 'http://pap.internal',
  auditUrl: 'http://audit.internal',
  pipTimeoutMs: 50,
};

const PRINCIPAL: EffectivePrincipal = {
  id: 'riya',
  tenantId: 'acme',
  roles: ['finance_manager'],
  attr: { department: 'finance' },
};

describe('HttpPipClient — PIP fetch timeout (fail-closed, DESIGN §9 D8)', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('passes an AbortSignal to fetch so a hung PAP cannot stall the PEP', async () => {
    const fetchMock = jest.fn(
      (_url: string | URL, init?: RequestInit): Promise<Response> =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(PRINCIPAL),
        } as Response).then((res) => {
          expect(init?.signal).toBeInstanceOf(AbortSignal);
          return res;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpPipClient(OPTIONS);
    const result = await client.resolve('riya', 'acme', 'acme.finance', true);

    expect(result).toEqual(PRINCIPAL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('REJECTS (fail-closed) when the PAP hangs past the timeout — the abort fires', async () => {
    // Honor the AbortSignal: reject with an AbortError when it aborts, exactly as
    // the platform fetch does on AbortSignal.timeout — never resolve.
    globalThis.fetch = ((_url: string | URL, init?: RequestInit): Promise<Response> => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const client = new HttpPipClient(OPTIONS);

    await expect(client.resolve('riya', 'acme', 'acme.finance', true)).rejects.toThrow(/timed out/);
  });

  it('REJECTS (fail-closed) on a non-OK PAP response (never fabricates a principal)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({ ok: false, status: 503 })) as unknown as typeof fetch;

    const client = new HttpPipClient(OPTIONS);

    await expect(client.resolve('riya', 'acme', 'acme.finance', true)).rejects.toThrow(
      /PIP resolve failed/,
    );
  });
});
