import { DomainError } from '@kernel/core';

/**
 * The gateway could not get a usable response from an upstream service — it was
 * unreachable, the connection failed, or it timed out. Maps to HTTP 502/504 (the
 * GlobalExceptionFilter distinguishes via `reason`). This is an INFRASTRUCTURE
 * failure of the proxy hop, NOT a domain/authorization outcome of the upstream
 * (whose own 4xx/5xx bodies are streamed back verbatim by the proxy controller).
 */
export class UpstreamUnavailableError extends DomainError {
  public readonly code = 'upstream_unavailable';

  constructor(message = 'Upstream service unavailable', reason?: string) {
    super(message, reason);
  }
}
