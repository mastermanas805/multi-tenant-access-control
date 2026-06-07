/**
 * The DESIGN §8.1 error envelope. EVERY 4xx/5xx response across every service
 * uses this exact shape, so the field set is a cross-service contract. The
 * authz-admin GlobalExceptionFilter is the canonical producer; every new service
 * reuses the same filter shape and therefore this type.
 *
 *   { "error": { "code", "message", "reason?", "decisionId?", "traceId?" } }
 */
export interface ErrorEnvelope {
  readonly error: ErrorEnvelopeBody;
}

export interface ErrorEnvelopeBody {
  /** Stable machine-readable code (snake_case), e.g. `forbidden`, `not_found`. */
  readonly code: string;
  /** Human-readable message. */
  readonly message: string;
  /** The specific rule/condition that failed (e.g. `condition failed: amount<10000`). */
  readonly reason?: string;
  /** The PDP decision id when the response stems from an authorization decision. */
  readonly decisionId?: string;
  /** The correlation/trace id (echoed from `x-trace-id`); links to logs + audit. */
  readonly traceId?: string;
}
