import { Inject, Injectable, Logger } from '@nestjs/common';

import { type EffectivePrincipal } from '@contracts/core';

import { AUTHZ_OPTIONS, type AuthzModuleOptions } from '../module/authz.options';
import { type PipClient } from './pip-client.port';
import { TtlLruCache } from './ttl-lru-cache';

const DEFAULT_TTL_MS = 5_000; // DESIGN §9.1 staleness ceiling (~5s).
const DEFAULT_MAX_ENTRIES = 10_000; // DESIGN App. D.3 active working set.
const DEFAULT_PIP_TIMEOUT_MS = 2_000; // DESIGN §9 D8 — bound a hung PAP, fail-closed.

/**
 * HTTP PIP implementation (DESIGN §3.2 PIP, §3.5). Resolves the principal's
 * effective roles/attrs from the PAP principal-resolution endpoint and caches it
 * read-through with a bounded TTL + LRU (DESIGN §9.1, App. D.3):
 *
 *   GET {papUrl}/v1/principals/:userId/effective?scope=&tenantId=
 *
 * Bounded staleness: a cache hit serves within the TTL; a miss does a synchronous
 * fetch from the owner. Sensitive actions pass `forceFresh` to bypass the cache
 * entirely (DESIGN §3.5, §9.1). Single-flight de-dupes concurrent misses for the
 * same key so a burst doesn't stampede the PAP (DESIGN §8.7).
 *
 * Fail-closed (DESIGN §9 D8): a fetch error throws — the PEP denies; it never
 * fabricates roles. (Per §9.1, low-risk reads MAY serve last-known until TTL; that
 * policy is layered in the PEP, not here, so the PIP stays a pure resolver.)
 */
@Injectable()
export class HttpPipClient implements PipClient {
  private readonly logger = new Logger(HttpPipClient.name);
  private readonly cache: TtlLruCache<EffectivePrincipal>;
  /** In-flight fetches keyed by cache key — single-flight to prevent stampede. */
  private readonly inFlight = new Map<string, Promise<EffectivePrincipal>>();
  /** Per-request PIP fetch timeout (ms) — bound a hung PAP, fail-closed (D8). */
  private readonly timeoutMs: number;

  constructor(@Inject(AUTHZ_OPTIONS) private readonly options: AuthzModuleOptions) {
    this.cache = new TtlLruCache<EffectivePrincipal>(
      options.pipCacheMaxEntries ?? DEFAULT_MAX_ENTRIES,
      options.pipCacheTtlMs ?? DEFAULT_TTL_MS,
    );
    this.timeoutMs = options.pipTimeoutMs ?? DEFAULT_PIP_TIMEOUT_MS;
  }

  public async resolve(
    userId: string,
    tenantId: string,
    scope: string,
    forceFresh = false,
  ): Promise<EffectivePrincipal> {
    const key = this.cacheKey(userId, tenantId, scope);

    if (!forceFresh) {
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const pending = this.inFlight.get(key);
      if (pending !== undefined) {
        return pending;
      }
    }

    const fetchPromise = this.fetchAndCache(key, userId, tenantId, scope);
    if (!forceFresh) {
      this.inFlight.set(key, fetchPromise);
    }
    try {
      return await fetchPromise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Explicit invalidation hook (a PAP change-event consumer would call this — DESIGN §3.4). */
  public invalidate(userId: string, tenantId: string, scope: string): void {
    this.cache.delete(this.cacheKey(userId, tenantId, scope));
  }

  private async fetchAndCache(
    key: string,
    userId: string,
    tenantId: string,
    scope: string,
  ): Promise<EffectivePrincipal> {
    const url = new URL(
      `/v1/principals/${encodeURIComponent(userId)}/effective`,
      this.options.papUrl,
    );
    url.searchParams.set('tenantId', tenantId);
    url.searchParams.set('scope', scope);

    // Bound the call so a hung PAP cannot stall the PEP (and, on the sensitive
    // path, cannot pin the RLS-scoped Postgres transaction). On timeout fetch
    // rejects with a TimeoutError/AbortError, which propagates up so the PEP
    // denies — fail-closed (DESIGN §9 D8). We never fabricate a principal.
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new Error(
          `PIP resolve timed out after ${String(this.timeoutMs)}ms for ` +
            `${userId}@${tenantId} (${scope})`,
        );
      }
      throw err;
    }
    if (!response.ok) {
      throw new Error(
        `PIP resolve failed: ${String(response.status)} for ${userId}@${tenantId} (${scope})`,
      );
    }
    const principal = (await response.json()) as EffectivePrincipal;
    this.cache.set(key, principal);
    this.logger.debug(`PIP cache fill ${key} (${String(principal.roles.length)} roles)`);
    return principal;
  }

  private cacheKey(userId: string, tenantId: string, scope: string): string {
    return `${tenantId}::${userId}::${scope}`;
  }
}
