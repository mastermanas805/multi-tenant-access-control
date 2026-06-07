/**
 * Configuration for the reusable AuthzModule (DESIGN §4.4). A consuming service
 * supplies these (from its own typed config) so the PEP knows where the PDP, PAP
 * and Audit live. Wired in from CERBOS_URL / PAP_URL / AUDIT_URL.
 */
export interface AuthzModuleOptions {
  /** Cerbos PDP address (the co-located sidecar/DaemonSet over loopback), e.g. `localhost:3593`. */
  readonly cerbosUrl: string;
  /** PAP base URL for principal resolution, e.g. `http://authz-admin:3000`. */
  readonly papUrl: string;
  /** Audit service base URL for decision records, e.g. `http://audit:3000`. */
  readonly auditUrl: string;
  /** PIP cache TTL in milliseconds (bounded staleness, DESIGN §9.1). Default 5000. */
  readonly pipCacheTtlMs?: number;
  /** PIP cache max entries (LRU, DESIGN §9.1, App. D.3). Default 10000. */
  readonly pipCacheMaxEntries?: number;
  /**
   * Per-request PIP fetch timeout in milliseconds (DESIGN §9 D8, fail-closed). A
   * hung PAP must never stall the PEP — and, since the resolve runs inside the
   * RLS-scoped DB transaction on the sensitive path, must never pin a Postgres
   * connection. On timeout the fetch aborts and the resolve rejects, so the PEP
   * denies rather than waits. Default 2000.
   */
  readonly pipTimeoutMs?: number;
  /**
   * Shared secret the gateway signs the internal identity token's HS256 JWS with
   * (the gateway's `INTERNAL_TOKEN_SECRET`). When set, the IdentityContextMiddleware
   * VERIFIES `x-internal-identity-signature` over the claims (iss=api-gateway + exp)
   * and rejects (401) a missing/invalid signature — the production path (DESIGN §7,
   * confused-deputy defense). When unset/empty, the middleware runs the documented
   * DEV/TEST placeholder that only base64url-decodes `x-internal-identity` (so the
   * unit/e2e/integration suites, which set the principal context directly without a
   * real gateway hop, still pass). Production deployments MUST set it.
   */
  readonly internalTokenSecret?: string;
  /**
   * Expected `iss` claim of the signed internal token — the gateway's
   * `INTERNAL_TOKEN_ISSUER` (DESIGN §5, §7). Default `api-gateway`. Only consulted
   * when `internalTokenSecret` enables signature verification.
   */
  readonly internalTokenIssuer?: string;
  /**
   * Clock-skew tolerance (seconds) applied to the internal token's `exp` check.
   * Default 60. Only consulted when signature verification is enabled.
   */
  readonly internalTokenClockToleranceSeconds?: number;
}

/** DI token for the resolved AuthzModuleOptions. */
export const AUTHZ_OPTIONS = Symbol('AUTHZ_OPTIONS');

/** Async factory for AuthzModule.forRootAsync (so options come from ConfigService). */
export interface AuthzModuleAsyncOptions {
  readonly imports?: unknown[];
  readonly inject?: unknown[];
  readonly useFactory: (...args: never[]) => AuthzModuleOptions | Promise<AuthzModuleOptions>;
}
