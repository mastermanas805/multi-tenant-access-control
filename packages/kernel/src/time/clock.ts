/**
 * Clock port. Use-cases depend on this rather than `new Date()` directly so that
 * time is deterministic and mockable in unit tests.
 */
export interface Clock {
  now(): Date;
}

/** Production adapter backed by the system clock. */
export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

/** DI token for the Clock port. */
export const CLOCK = Symbol('CLOCK');
