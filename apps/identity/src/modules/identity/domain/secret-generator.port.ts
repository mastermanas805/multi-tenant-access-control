/**
 * Port for generating cryptographically-random opaque secrets (refresh tokens
 * and session ids). Kept behind a port so use-cases stay deterministic in tests
 * (inject a stub) while production uses Node's CSPRNG (crypto.randomBytes).
 */
export interface SecretGenerator {
  /** A high-entropy, URL-safe opaque refresh-token value. */
  refreshToken(): string;

  /** A unique session id (the JWT `sid`). */
  sessionId(): string;
}

/** DI token for the secret generator port. */
export const SECRET_GENERATOR = Symbol('SECRET_GENERATOR');
