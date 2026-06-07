import { type InternalIdentityToken } from '@contracts/core';

import { IdentityContextMiddleware } from '@authz/pep';

/**
 * Test helper that builds the internal-identity header the PAP's
 * IdentityContextMiddleware reads. The e2e/unit suites run with NO
 * INTERNAL_TOKEN_SECRET configured (NODE_ENV=test), so the middleware runs the
 * documented DEV/TEST placeholder that base64url-decodes `x-internal-identity`
 * WITHOUT a signature — exactly the path the Expense PEP e2e exercises. The signed
 * production path is covered by the middleware unit spec + the integration suite.
 *
 * Returns a `{ headerName: value }` object so a test can spread it into supertest's
 * `.set(...)`. The principal's tenant/actor/platform-admin is sourced ONLY from this
 * verified token — never from `x-tenant-id`/`x-actor-id`/`x-platform-admin` headers
 * (DESIGN §5/§6/§7).
 */
export function identityHeaders(args: {
  tenantId: string;
  sub?: string;
  actorId?: string;
  sessionId?: string;
  platformAdmin?: boolean;
}): Record<string, string> {
  const token: InternalIdentityToken = {
    sub: args.sub ?? 'test-user',
    tid: args.tenantId,
    actorId: args.actorId ?? args.sub ?? 'test-user',
    sessionId: args.sessionId ?? 'sess_e2e',
    ...(args.platformAdmin ? { platformAdmin: true } : {}),
  };
  return {
    [IdentityContextMiddleware.TOKEN_HEADER]: Buffer.from(
      JSON.stringify(token),
      'utf8',
    ).toString('base64url'),
  };
}
