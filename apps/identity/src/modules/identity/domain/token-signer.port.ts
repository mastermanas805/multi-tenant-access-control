/**
 * Standard registered + custom JWT claims for an issued access token. Mirrors the
 * InternalIdentityToken contract semantics: IDENTITY + TENANT only, NO roles or
 * permissions (DESIGN §5, D4). `sub` = user id, `tid` = active tenant, `sid` =
 * session id, `act` = acting caller (equals sub for a direct user login).
 */
export interface AccessTokenClaims {
  /** Subject — the user id. */
  sub: string;
  /** Active tenant context (never client-settable). */
  tid: string;
  /** Session id linking the token to a login session. */
  sid: string;
  /** The acting caller; equals `sub` for a direct user-initiated login. */
  act: string;
  /** Issuer URL. */
  iss: string;
  /** Audience — the API the token is minted for. */
  aud: string;
  /**
   * Platform-admin scope (DESIGN §6 / App. A). The signer emits the `platform_admin`
   * JWT claim ONLY when this is true, so a normal user's token simply omits it (the
   * gateway + downstream control plane treat absence as not-an-admin, fail-closed).
   */
  platformAdmin?: boolean;
}

/** A signed token plus the absolute expiry the signer stamped into it. */
export interface SignedToken {
  /** The compact-serialized JWS (header.payload.signature). */
  token: string;
  /** Unix-seconds `exp` the signer embedded. */
  expiresAt: number;
  /** Unix-seconds `iat` the signer embedded. */
  issuedAt: number;
}

/** One JWK in a JWKS document (RSA public key, RS256). */
export interface JsonWebKey {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;
  e: string;
}

/** A JWKS document as published at /.well-known/jwks.json. */
export interface JsonWebKeySet {
  keys: JsonWebKey[];
}

/**
 * Port for signing RS256 JWTs and exposing the public verification key as a
 * JWKS. The infrastructure adapter implements this with Node's `crypto`, keeping
 * the algorithm/key material entirely out of the domain + application layers.
 */
export interface TokenSigner {
  /**
   * Signs an access token. The signer computes `iat`/`exp` from the supplied
   * clock-now and ttl (seconds) so token lifetime is policy, not caller input.
   */
  signAccessToken(claims: AccessTokenClaims, nowSeconds: number, ttlSeconds: number): SignedToken;

  /** Returns the public JWKS for token verification by relying parties. */
  jwks(): JsonWebKeySet;
}

/** DI token for the token signer port. */
export const TOKEN_SIGNER = Symbol('TOKEN_SIGNER');
