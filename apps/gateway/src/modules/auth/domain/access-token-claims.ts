/**
 * The verified claim set of an end-user access token (DESIGN §5). Mirrors the
 * Identity service's minted shape: IDENTITY + TENANT only, NO roles/permissions
 * (D4). `sub` = user id, `tid` = active tenant, `sid` = session id, `act` = the
 * acting caller (equals `sub` for a direct login). Registered claims `iss`/`aud`/
 * `exp`/`iat`/`nbf` are verified by the token verifier.
 */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly tid: string;
  readonly sid: string;
  /** Optional `act` claim; the verifier defaults it to `sub` when absent. */
  readonly act?: string;
  readonly iss?: string;
  readonly aud?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly nbf?: number;
}
