import { type InternalIdentityToken } from '@contracts/core';

/**
 * The per-request authorization principal context the PEP reads. Populated by the
 * IdentityContextMiddleware from the signed INTERNAL identity token (DESIGN §4.3
 * step 1, §5, §7) — identity + tenant + actor only, NO permissions (D4). The PEP
 * resolves roles/attrs per-request via the PIP.
 *
 * Attached to the Express request as `req.authzPrincipal` (see the module's
 * ambient augmentation), so the guard and decorators read it type-safely.
 */
export interface AuthzPrincipalContext {
  /** The end-user subject (principal id) — the token `sub`. */
  readonly principalId: string;
  /** The active tenant context — the token `tid` (DESIGN §6). */
  readonly tenantId: string;
  /** The caller acting on the principal's behalf — the token `actorId` (DESIGN §7). */
  readonly actorId: string;
  /** The end-user session id — the token `sessionId`. */
  readonly sessionId: string;
}

/** Builds the principal context from a verified internal identity token. */
export function principalContextFromToken(token: InternalIdentityToken): AuthzPrincipalContext {
  return {
    principalId: token.sub,
    tenantId: token.tid,
    actorId: token.actorId,
    sessionId: token.sessionId,
  };
}
