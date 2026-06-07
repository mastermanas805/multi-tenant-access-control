import { DomainError } from '@kernel/core';

/**
 * Authentication (not authorization) failure at the edge: the caller could not
 * prove who they are — a missing/malformed/expired/forged user JWT, a bad
 * signature, or a claim that fails verification. Distinct from ForbiddenError
 * (403, "known but not allowed"); this maps to HTTP 401.
 *
 * The kernel has no 401 primitive because authentication is the edge's concern,
 * so it lives here. The GlobalExceptionFilter maps it to 401 + the §8.1 envelope
 * (code `unauthenticated`). Messages are deliberately generic so a probe cannot
 * distinguish "no token" from "bad signature" from "expired".
 */
export class UnauthenticatedError extends DomainError {
  public readonly code = 'unauthenticated';

  constructor(message = 'Authentication required', reason?: string) {
    super(message, reason);
  }
}
