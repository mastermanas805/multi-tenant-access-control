/**
 * The outcome of consuming one request slot against a client's window.
 */
export interface RateLimitDecision {
  /** Whether the request is permitted (under the per-window quota). */
  readonly allowed: boolean;
  /** Remaining permitted requests in the current window (>= 0). */
  readonly remaining: number;
  /** The per-window quota (echoed for the X-RateLimit-Limit header). */
  readonly limit: number;
  /** Unix-ms timestamp when the current window resets. */
  readonly resetAt: number;
  /** When denied, seconds the client should wait before retrying. */
  readonly retryAfterSeconds: number;
}

/** Configuration for a fixed-window limiter. */
export interface RateLimiterOptions {
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Maximum requests permitted per client per window. */
  readonly max: number;
}

interface WindowState {
  count: number;
  windowStart: number;
}

/**
 * A dependency-free, in-memory fixed-window rate limiter (DESIGN §4.4, §10 — edge
 * DoS protection). Pure domain logic: it owns no framework types and takes the
 * clock-now as a parameter so it is fully deterministic under test.
 *
 * Fixed-window is deliberately the simplest correct algorithm for the reference
 * impl. A production edge would use a distributed token bucket (e.g. Redis) so the
 * quota is shared across gateway replicas; this single-process map is documented
 * as the swap point. State is keyed by an opaque client key (the caller chooses —
 * here the authenticated subject when present, else the source IP).
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, WindowState>();
  private readonly windowMs: number;
  private readonly max: number;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.max = options.max;
  }

  /**
   * Records one request for `key` at time `nowMs` and returns whether it is
   * within quota. A new window opens lazily when the previous one has elapsed.
   */
  public consume(key: string, nowMs: number): RateLimitDecision {
    const existing = this.windows.get(key);
    const isNewWindow = existing === undefined || nowMs - existing.windowStart >= this.windowMs;

    const state: WindowState = isNewWindow
      ? { count: 0, windowStart: nowMs }
      : existing;

    const resetAt = state.windowStart + this.windowMs;

    if (state.count >= this.max) {
      // Over quota: do NOT increment further (avoids unbounded growth under flood).
      this.windows.set(key, state);
      return {
        allowed: false,
        remaining: 0,
        limit: this.max,
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - nowMs) / 1000)),
      };
    }

    state.count += 1;
    this.windows.set(key, state);
    return {
      allowed: true,
      remaining: Math.max(0, this.max - state.count),
      limit: this.max,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  /** Evicts windows that have fully elapsed (bounds memory under churn). */
  public prune(nowMs: number): void {
    for (const [key, state] of this.windows) {
      if (nowMs - state.windowStart >= this.windowMs) {
        this.windows.delete(key);
      }
    }
  }
}
