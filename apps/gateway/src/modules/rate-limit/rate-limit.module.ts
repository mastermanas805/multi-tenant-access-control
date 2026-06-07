import { Module } from '@nestjs/common';

import { RateLimitMiddleware } from './presentation/rate-limit.middleware';

/**
 * Provides the edge rate-limit middleware (DESIGN §4.4, §10). The middleware is
 * applied in AppModule.configure BEFORE auth so an unauthenticated flood is shed
 * cheaply. The limiter algorithm itself lives in the framework-free domain.
 */
@Module({
  providers: [RateLimitMiddleware],
  exports: [RateLimitMiddleware],
})
export class RateLimitModule {}
