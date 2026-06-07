import { ValidationError } from '@kernel/core';

/**
 * An opaque, already-computed password hash (the encoded digest string, e.g.
 * `scrypt$<salt>$<dk>`). The domain never sees plaintext beyond the verify call;
 * the actual KDF lives behind the `PasswordHasher` port in infrastructure.
 */
export class PasswordHash {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Wraps an encoded hash string produced by the PasswordHasher port. */
  public static fromEncoded(value: string): PasswordHash {
    if (value.trim().length === 0) {
      throw new ValidationError('Password hash must not be empty', 'password_hash_empty');
    }
    return new PasswordHash(value);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other?: PasswordHash): boolean {
    return this.value === other?.value;
  }
}
