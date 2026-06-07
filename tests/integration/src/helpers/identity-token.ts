import { createHmac } from 'node:crypto';

import { type InternalIdentityToken } from '@contracts/core';

import { IdentityContextMiddleware } from '@authz/pep';

/** The headers the Expense PEP's IdentityContextMiddleware reads (DESIGN §5, §7). */
export const INTERNAL_IDENTITY_HEADER = IdentityContextMiddleware.TOKEN_HEADER;
export const INTERNAL_IDENTITY_SIGNATURE_HEADER = IdentityContextMiddleware.SIGNATURE_HEADER;

/**
 * The shared secret the integration stack signs the internal identity token with
 * and the Expense PEP verifies against (its `INTERNAL_TOKEN_SECRET`). The
 * integration suite runs the PRODUCTION verification path (DESIGN §7), so it signs
 * a real HS256 JWS exactly as the gateway would — minus the gateway hop, which the
 * gateway suite covers separately.
 */
export const INTERNAL_TOKEN_SECRET = 'int-pep-internal-secret';
export const INTERNAL_TOKEN_ISSUER = 'api-gateway';

function base64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/**
 * Builds the base64url(JSON) internal identity token the gateway would mint and
 * the Expense PEP reads (DESIGN §4.3 step 1, §7).
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
  platformAdmin?: boolean;
}): string {
  return Buffer.from(JSON.stringify(claimsFor(args)), 'utf8').toString('base64url');
}

/**
 * The HS256 compact JWS over the same claims (+ iss/iat/exp) the gateway forwards
 * as `x-internal-identity-signature` and the PEP verifies (DESIGN §7). Mirrors the
 * gateway's HmacInternalTokenMinter exactly so the integration suite drives the
 * production signature-verification path.
 */
export function internalIdentitySignature(args: {
  sub: string;
  tid: string;
  actorId?: string;
  sessionId?: string;
  platformAdmin?: boolean;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: 'gw-int-2026' };
  const payload = {
    ...claimsFor(args),
    iss: INTERNAL_TOKEN_ISSUER,
    iat: nowSeconds,
    exp: nowSeconds + 120,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', INTERNAL_TOKEN_SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function claimsFor(args: {
  sub: string;
  tid: string;
  actorId?: string;
  sessionId?: string;
  platformAdmin?: boolean;
}): InternalIdentityToken {
  return {
    sub: args.sub,
    tid: args.tid,
    actorId: args.actorId ?? args.sub,
    sessionId: args.sessionId ?? `sess_int_${args.sub}`,
    ...(args.platformAdmin ? { platformAdmin: true } : {}),
  };
}

/**
 * Convenience: the SIGNED internal-identity header pair the gateway forwards and a
 * downstream service (PAP/Audit) verifies — both `x-internal-identity` (claims) and
 * `x-internal-identity-signature` (HS256 JWS). Spread into supertest `.set(...)`.
 */
export function internalIdentityHeaders(args: {
  sub: string;
  tid: string;
  actorId?: string;
  sessionId?: string;
  platformAdmin?: boolean;
}): Record<string, string> {
  return {
    [INTERNAL_IDENTITY_HEADER]: internalIdentityToken(args),
    [INTERNAL_IDENTITY_SIGNATURE_HEADER]: internalIdentitySignature(args),
  };
}
