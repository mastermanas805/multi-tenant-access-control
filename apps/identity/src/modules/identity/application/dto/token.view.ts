/**
 * Read-model view of an issued OAuth/OIDC token response. Decouples the API
 * shape from internal signing details. `expiresIn` is the access-token lifetime
 * in seconds (the standard OAuth field).
 */
export interface TokenView {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  /** The user id (JWT `sub`) — convenience echo for clients. */
  sub: string;
  /** The tenant context (JWT `tid`). */
  tid: string;
  /** The session id (JWT `sid`). */
  sid: string;
}

/** A JWK in the published key set. */
export interface JwkView {
  kty: string;
  use: string;
  alg: string;
  kid: string;
  n: string;
  e: string;
}

/** The JWKS document view. */
export interface JwksView {
  keys: JwkView[];
}
