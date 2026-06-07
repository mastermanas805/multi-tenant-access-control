import { HttpException, HttpStatus, Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';

import { type Clock, CLOCK } from '@kernel/core';

import { ConfigService } from '../../../config/config.service';
import { FixedWindowRateLimiter } from '../domain/fixed-window-rate-limiter';

/**
 * Edge rate limiter (DESIGN §4.4, §10). Applied BEFORE auth so an unauthenticated
 * flood is shed cheaply. Keys by the source IP (pre-auth there is no verified
 * subject yet). Emits the standard X-RateLimit-* headers and a Retry-After on a
 * 429; the GlobalExceptionFilter renders the 429 as the §8.1 envelope (code
 * `rate_limited`). When disabled via config it is a transparent pass-through.
 *
 * The limiter algorithm lives in the framework-free domain (FixedWindowRate-
 * Limiter); this middleware is the thin Express adapter that supplies the
 * client key + injectable clock and translates the decision into HTTP.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly limiter: FixedWindowRateLimiter;
  private readonly enabled: boolean;

  constructor(
    config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.enabled = config.values.RATE_LIMIT_ENABLED;
    this.limiter = new FixedWindowRateLimiter({
      windowMs: config.values.RATE_LIMIT_WINDOW_MS,
      max: config.values.RATE_LIMIT_MAX,
    });
  }

  public use(req: Request, res: Response, next: NextFunction): void {
    if (!this.enabled) {
      next();
      return;
    }

    const key = this.clientKey(req);
    const decision = this.limiter.consume(key, this.clock.now().getTime());

    res.setHeader('X-RateLimit-Limit', String(decision.limit));
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(decision.resetAt / 1000)));

    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    next();
  }

  /** Best-effort client identifier from the connection / forwarded headers. */
  private clientKey(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0]?.trim() ?? 'unknown';
    }
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  }
}
