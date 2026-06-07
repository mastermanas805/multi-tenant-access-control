import { ValidationError } from '@kernel/core';

/** A conservative, case-insensitive email shape check (RFC-pragmatic, not exhaustive). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email value object. Normalizes to lower-case so lookups are case-insensitive
 * (the username in the OIDC password grant). Identity by value, not reference.
 */
export class Email {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Validates and normalizes a raw email string. */
  public static fromString(value: string): Email {
    const normalized = value.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      throw new ValidationError('Invalid email', 'email_invalid');
    }
    return new Email(normalized);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other?: Email): boolean {
    return this.value === other?.value;
  }
}
