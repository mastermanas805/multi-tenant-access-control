import { type InternalIdentityToken } from '@contracts/core';

import { IdentityContextMiddleware } from '@authz/pep';

/** The header the Expense PEP's IdentityContextMiddleware reads (DESIGN §5, §7). */
export const INTERNAL_IDENTITY_HEADER = IdentityContextMiddleware.TOKEN_HEADER;

/**
 * Builds the base64url(JSON) internal identity token the gateway would mint and
 * the Expense PEP decodes (DESIGN §4.3 step 1, §7). The integration tests inject
 * it directly so the PEP -> Cerbos -> PIP -> RLS chain is exercised exactly as in
 * production, minus the gateway hop (which the gateway suite covers separately).
 *
 * `sub` is the principal id (= the role-assignment `user_id`/expense `owner_id`),
 * `tid` is the active tenant UUID (drives RLS + the tenant guardrail). `actorId`
 * equals `sub` for a direct user call; `sessionId` links the decision to a session.
 */
export function internalIdentityToken(args: {
  sub: string;
  tid: string;
  actorId?: string;
  sessionId?: string;
}): string {
  const token: InternalIdentityToken = {
    sub: args.sub,
    tid: args.tid,
    actorId: args.actorId ?? args.sub,
    sessionId: args.sessionId ?? `sess_int_${args.sub}`,
  };
  return Buffer.from(JSON.stringify(token), 'utf8').toString('base64url');
}
