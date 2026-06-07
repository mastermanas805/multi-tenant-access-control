import { Injectable, Logger } from '@nestjs/common';

import { UpstreamUnavailableError } from '../../../shared/errors/upstream.error';
import {
  type UpstreamHttpClient,
  type UpstreamRequest,
  type UpstreamResponse,
} from '../domain/upstream-http-client.port';

/**
 * Upstream HTTP client backed by the runtime global `fetch` (Node 20+) — no
 * external HTTP library. Forwards the method/headers/body verbatim and returns
 * the upstream response UNCHANGED (any status, headers and body) so a service's
 * own §8.1 envelope reaches the client intact.
 *
 * A request is aborted after `timeoutMs` (fail-fast, DESIGN §9). A timeout or any
 * connectivity failure (DNS, refused) becomes an UpstreamUnavailableError —
 * distinguished by `reason` so the filter renders 504 vs 502. An upstream that
 * answered with a 5xx is NOT an error here; its body is streamed back.
 */
@Injectable()
export class FetchUpstreamHttpClient implements UpstreamHttpClient {
  private readonly logger = new Logger(FetchUpstreamHttpClient.name);

  public async forward(request: UpstreamRequest): Promise<UpstreamResponse> {
    // GET/HEAD must not carry a body (undici rejects it).
    const hasBody = request.body !== undefined && request.body.length > 0;
    const bodyless = request.method === 'GET' || request.method === 'HEAD';

    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: hasBody && !bodyless ? request.body : undefined,
        signal: AbortSignal.timeout(request.timeoutMs),
        redirect: 'manual',
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      this.logger.warn(
        `Upstream ${request.method} ${request.url} failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      throw new UpstreamUnavailableError(
        isTimeout ? 'Upstream service timed out' : 'Upstream service unavailable',
        isTimeout ? 'upstream_timeout' : 'upstream_connection_failed',
      );
    }

    const bodyBuffer = Buffer.from(await response.arrayBuffer());

    const headers: Record<string, string | string[]> = {};
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // Drop hop-by-hop / framing headers the gateway sets itself.
      if (lower === 'content-length' || lower === 'transfer-encoding' || lower === 'connection') {
        return;
      }
      headers[key] = value;
    });

    return { status: response.status, headers, body: bodyBuffer };
  }
}
