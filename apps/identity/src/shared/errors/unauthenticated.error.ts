import { DomainError } from '@kernel/core';

/**
 * Authentication (not authorization) failure: the caller could not prove who
 * they are — bad credentials, an invalid/expired refresh token, etc. Distinct
 * from ForbiddenError (403, "known but not allowed"); this maps to HTTP 401.
 *
 * The kernel has no 401 primitive because authentication is the identity
 * service's concern, so it lives here (the IdP) rather than in the shared kernel.
 * The GlobalExceptionFilter maps it to 401 + the §8.1 envelope (code
 * `unauthenticated`). Messages are deliberately generic to avoid enumeration.
 */
export class UnauthenticatedError extends DomainError {
  public readonly code = 'unauthenticated';

  constructor(message = 'Authentication failed', reason?: string) {
    super(message, reason);
  }
}
