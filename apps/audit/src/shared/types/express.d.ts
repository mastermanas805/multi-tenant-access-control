/**
 * Express Request augmentation for the Audit service.
 *
 * The service's own request-context middleware (request-context.ts) sets
 * `req.traceId`; declaration merging exposes it type-safely to the logging
 * interceptor and the section-8.1 global exception filter. Mirrors the
 * convention in apps/expense/src/shared/types/express.d.ts.
 */
import 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id (set by RequestContextMiddleware). */
      traceId?: string;
    }
  }
}

export {};
