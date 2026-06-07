import { type InternalIdentityToken } from '@contracts/core';

import { IdentityContextMiddleware } from '@authz/pep';

/**
 * Test helper that builds the internal-identity header the Audit READ endpoints'
 * IdentityContextMiddleware reads. The e2e suite runs with NO INTERNAL_TOKEN_SECRET
 * configured (NODE_ENV=test), so the middleware runs the documented DEV/TEST
 * placeholder that base64url-decodes `x-internal-identity` WITHOUT a signature — the
 * same path the Expense PEP e2e exercises. The signed production path is covered by
 * the middleware unit spec + the integration suite.
 *
 * The read is scoped to the caller's VERIFIED tenant (DESIGN §6/§7): a non-admin
 * caller can only read its own tenant's decision log; a verified platform-admin may
 * read cross-tenant. Returns a `{ headerName: value }` object for supertest `.set`.
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
