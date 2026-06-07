/**
 * Issuance policy (issuer, audience, lifetimes) the use-cases stamp into every
 * token. Provided via a DI token whose factory reads the typed ConfigService at
 * the module boundary, so the application layer stays free of config plumbing.
 */
export interface TokenIssuancePolicy {
  issuer: string;
  audience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

/** DI token for the issuance policy. */
export const TOKEN_ISSUANCE_POLICY = Symbol('TOKEN_ISSUANCE_POLICY');
