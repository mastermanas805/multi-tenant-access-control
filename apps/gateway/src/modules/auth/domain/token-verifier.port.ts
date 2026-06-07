import { type AccessTokenClaims } from './access-token-claims';
import { type BearerToken } from './value-objects/bearer-token.vo';

/**
 * Port for verifying an end-user access token (DESIGN §4.3 step 1, §5). The
 * infrastructure adapter fetches the Identity service's JWKS and checks the RS256
 * signature + registered claims (iss/aud/exp/nbf), keeping the crypto + network
 * entirely out of the domain/application layers.
 *
 * Contract: returns the verified claims on success; THROWS UnauthenticatedError
 * on ANY failure (bad signature, expired, wrong issuer/audience, unknown key).
 * Fail-closed (D8) — the verifier never returns partial/unverified claims.
 */
export interface TokenVerifier {
  verify(token: BearerToken): Promise<AccessTokenClaims>;
}

/** DI token for the token verifier port. */
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
