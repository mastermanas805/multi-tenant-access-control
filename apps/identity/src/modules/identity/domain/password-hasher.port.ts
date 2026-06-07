import { type PasswordHash } from './value-objects/password-hash.vo';

/**
 * Port for password hashing/verification. The domain depends ONLY on this
 * interface; the infrastructure layer implements it with a real KDF (scrypt via
 * Node's crypto) using constant-time comparison. Keeps the crypto algorithm out
 * of the domain so it can be swapped (argon2/bcrypt) without touching use-cases.
 */
export interface PasswordHasher {
  /** Hashes a plaintext password into an encoded, salted digest. */
  hash(plaintext: string): Promise<PasswordHash>;

  /**
   * Verifies a plaintext candidate against an encoded hash in constant time.
   * Returns true on match, false otherwise (never throws on mismatch).
   */
  verify(plaintext: string, hash: PasswordHash): Promise<boolean>;

  /**
   * A fixed, valid dummy hash. Used to run a real verify even when no user was
   * found, so login latency does not leak whether an email exists (a timing
   * enumeration oracle). Always returns false on verify (no plaintext matches).
   */
  dummyHash(): PasswordHash;
}

/** DI token for the password hasher port. */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
