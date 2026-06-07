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
  /**
   * Optional `platform_admin` scope claim (DESIGN §6 / App. A). When `true` the
   * IdP has granted this principal the platform-admin role; the gateway carries it
   * INTO the signed internal token so the control-plane PEP (the PAP) can authorize
   * platform-wide surfaces against a verified value. Absent/false = not an admin
   * (fail-closed): absence is never elevation.
   */
  readonly platformAdmin?: boolean;
  readonly iss?: string;
  readonly aud?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly nbf?: number;
}
