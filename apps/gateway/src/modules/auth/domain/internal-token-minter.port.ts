import { type InternalIdentityToken } from '@contracts/core';

/**
 * A minted internal identity token: the canonical claim payload plus its signed,
 * wire-ready serialization (DESIGN §5, §7).
 */
export interface MintedInternalToken {
  /** The identity+tenant claims (no permissions — D4). */
  readonly claims: InternalIdentityToken;
  /**
   * The base64url(JSON) form forwarded as the `x-internal-identity` header. This
   * is exactly what the downstream PEP's IdentityContextMiddleware decodes today
   * (the reference placeholder reads base64url JSON). It is the ONLY trusted
   * identity on the internal hop — the gateway re-derives it from the verified
   * user JWT every request (plaintext identity headers are never trusted, §7).
   */
  readonly headerValue: string;
  /**
   * The SIGNED compact JWS (HS256) over the same claims, forwarded as
   * `x-internal-identity-signature`. This is the production token-exchange artifact
   * (RFC 8693): when the PEP's `verifyToken` is upgraded from the placeholder
   * decode to JWKS/HMAC signature verification, THIS is what it verifies, proving
   * the gateway minted the context. Carried alongside so the upgrade is drop-in.
   */
  readonly signature: string;
}

/**
 * Port for minting the signed internal identity token from the verified end-user
 * identity (DESIGN §4.3 step 1, §5, §7). The infrastructure adapter signs it with
 * the gateway's internal key (a shared secret in the reference impl; an
 * asymmetric token-exchange key in production, RFC 8693). Crypto stays out of the
 * domain/application layers behind this port.
 */
export interface InternalTokenMinter {
  mint(claims: InternalIdentityToken): MintedInternalToken;
}

/** DI token for the internal token minter port. */
export const INTERNAL_TOKEN_MINTER = Symbol('INTERNAL_TOKEN_MINTER');
