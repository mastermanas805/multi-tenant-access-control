import { UnauthenticatedError } from '@kernel/core';

/**
 * Authentication failed: unknown user, wrong password, or a disabled account.
 * Maps to HTTP 401 and deliberately carries a GENERIC message so it cannot be
 * used as an account-enumeration oracle (DESIGN §7 / §10). The stable `reason`
 * distinguishes the cause for server-side logs only — both cases surface the
 * same client message.
 */
export class InvalidCredentialsError extends UnauthenticatedError {
  constructor(reason = 'invalid_credentials') {
    super('Invalid email or password', reason);
  }
}

/** A presented refresh token is unknown, expired, or already consumed. -> 401 */
export class InvalidRefreshTokenError extends UnauthenticatedError {
  constructor(reason = 'invalid_refresh_token') {
    super('Invalid or expired refresh token', reason);
  }
}
