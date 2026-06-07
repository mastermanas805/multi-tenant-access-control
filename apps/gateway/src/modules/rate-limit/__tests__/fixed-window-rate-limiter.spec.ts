import { FixedWindowRateLimiter } from '../domain/fixed-window-rate-limiter';

describe('FixedWindowRateLimiter (DESIGN §4.4, §10)', () => {
  it('allows up to `max` requests then denies within the same window', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 3 });
    const now = 10_000;

    expect(limiter.consume('ip', now).allowed).toBe(true);
    expect(limiter.consume('ip', now).allowed).toBe(true);
    const third = limiter.consume('ip', now);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = limiter.consume('ip', now);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('opens a fresh window after windowMs elapses', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.consume('ip', 0).allowed).toBe(true);
    expect(limiter.consume('ip', 500).allowed).toBe(false); // same window
    expect(limiter.consume('ip', 1000).allowed).toBe(true); // new window
  });

  it('tracks clients independently by key', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.consume('a', 0).allowed).toBe(true);
    expect(limiter.consume('b', 0).allowed).toBe(true);
    expect(limiter.consume('a', 0).allowed).toBe(false);
  });

  it('prune evicts elapsed windows', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 1 });
    limiter.consume('a', 0);
    limiter.prune(2000);
    // After pruning, the key gets a fresh window (allowed again).
    expect(limiter.consume('a', 2000).allowed).toBe(true);
  });
});
