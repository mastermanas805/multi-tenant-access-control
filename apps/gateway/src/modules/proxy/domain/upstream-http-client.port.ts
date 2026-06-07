/** An outbound proxied request to an upstream service (transport-agnostic). */
export interface UpstreamRequest {
  /** Absolute upstream URL (base + original path + query). */
  readonly url: string;
  /** HTTP method, verbatim from the client request. */
  readonly method: string;
  /** Final forwarded headers (client headers minus hop-by-hop + identity, plus the server-derived identity). */
  readonly headers: Record<string, string>;
  /** Raw request body bytes (empty for GET/HEAD). */
  readonly body: Buffer | undefined;
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number;
}

/** The upstream's response, streamed back to the client verbatim. */
export interface UpstreamResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  readonly body: Buffer;
}

/**
 * Port for forwarding a request to an upstream service (DESIGN §4.1). The
 * infrastructure adapter uses the runtime HTTP client; this keeps the proxy
 * use-case free of transport detail and trivially testable with a fake client.
 *
 * Contract: returns the upstream's response (ANY status, including its 4xx/5xx —
 * those are domain outcomes of the upstream and must reach the client unchanged).
 * THROWS UpstreamUnavailableError ONLY when no response could be obtained
 * (connection refused, DNS failure, timeout) — a true proxy-hop failure.
 */
export interface UpstreamHttpClient {
  forward(request: UpstreamRequest): Promise<UpstreamResponse>;
}

/** DI token for the upstream HTTP client port. */
export const UPSTREAM_HTTP_CLIENT = Symbol('UPSTREAM_HTTP_CLIENT');
