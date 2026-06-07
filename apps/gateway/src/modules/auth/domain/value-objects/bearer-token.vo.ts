import { UnauthenticatedError } from '@kernel/core';

/**
 * The raw compact JWT extracted from an `Authorization: Bearer <token>` header.
 * A value object so the parsing/shape rule lives in the domain and is reused by
 * both the auth guard and unit tests. Identity by value. Deliberately GENERIC on
 * failure (one message) so a probe cannot distinguish "no header" from "wrong
 * scheme" from "malformed" (DESIGN §7 / §10 — no auth oracle).
 */
export class BearerToken {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /**
   * Parses the `Authorization` header value. Accepts a case-insensitive `Bearer`
   * scheme and asserts the token is a well-formed compact JWS (three non-empty
   * base64url segments) BEFORE any crypto runs.
   */
  public static fromAuthorizationHeader(header: string | undefined): BearerToken {
    if (typeof header !== 'string' || header.trim().length === 0) {
      throw new UnauthenticatedError('Authentication required', 'missing_authorization');
    }
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match === null) {
      throw new UnauthenticatedError('Authentication required', 'invalid_authorization_scheme');
    }
    const token = match[1]?.trim() ?? '';
    if (!BearerToken.isCompactJws(token)) {
      throw new UnauthenticatedError('Authentication required', 'malformed_token');
    }
    return new BearerToken(token);
  }

  public toString(): string {
    return this.value;
  }

  /** A compact JWS is `header.payload.signature` — three non-empty segments. */
  private static isCompactJws(token: string): boolean {
    const parts = token.split('.');
    return parts.length === 3 && parts.every((p) => p.length > 0);
  }
}
