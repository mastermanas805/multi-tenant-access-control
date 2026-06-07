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
}

/** DI token for the resolved AuthzModuleOptions. */
export const AUTHZ_OPTIONS = Symbol('AUTHZ_OPTIONS');

/** Async factory for AuthzModule.forRootAsync (so options come from ConfigService). */
export interface AuthzModuleAsyncOptions {
  readonly imports?: unknown[];
  readonly inject?: unknown[];
  readonly useFactory: (...args: never[]) => AuthzModuleOptions | Promise<AuthzModuleOptions>;
}
