import { DomainError } from './domain-error';

/**
 * Authentication (not authorization) failure: the caller could not prove who they
 * are — missing/malformed/expired/forged credentials, a bad signature, or a claim
 * that fails verification. Distinct from ForbiddenError (403, "known but not
 * allowed"); this maps to HTTP 401.
 *
 * It lives in the kernel (rather than in each edge service) because more than one
 * service authenticates a caller: the IdP authenticates end-users, the gateway
 * authenticates the user JWT, and the PEP authenticates the gateway's signed
 * internal identity token. Each presentation layer's GlobalExceptionFilter maps
 * this to 401 + the §8.1 envelope (code `unauthenticated`). Messages are
 * deliberately generic so a probe cannot distinguish "no token" from "bad
 * signature" from "expired"; the optional `reason` is for server-side logs only.
 */
export class UnauthenticatedError extends DomainError {
  public readonly code = 'unauthenticated';

  constructor(message = 'Authentication required', reason?: string) {
    super(message, reason);
  }
}
