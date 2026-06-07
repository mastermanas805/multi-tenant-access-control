import { type GatewayIdentity } from '../../../auth/domain/gateway-identity';

/**
 * A request to proxy to an upstream service. The presentation layer assembles
 * this from the Express request; the use-case owns routing + identity injection.
 */
export interface ProxyRequestCommand {
  /** Inbound request path (e.g. `/v1/expenses/42/approve`), no query string. */
  readonly path: string;
  /** Raw query string WITHOUT the leading `?` (empty when none). */
  readonly queryString: string;
  /** HTTP method, verbatim. */
  readonly method: string;
  /** Raw inbound headers (mixed case; sanitized by the use-case). */
  readonly headers: Record<string, string | string[] | undefined>;
  /** Raw request body bytes (undefined for bodyless methods). */
  readonly body: Buffer | undefined;
  /**
   * The verified end-user identity, or null when the request was not
   * authenticated (only valid for public routes like /auth/*). NEVER derived from
   * client headers — set by the JwtAuthGuard from the verified JWT (§7).
   */
  readonly identity: GatewayIdentity | null;
}
