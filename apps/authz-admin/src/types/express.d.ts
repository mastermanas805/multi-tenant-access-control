import 'express';

/**
 * Ambient augmentation: attach the per-request trace id (set by
 * RequestContextMiddleware) onto Express's Request so the logging interceptor
 * and exception filter can read it type-safely.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      traceId?: string;
    }
  }
}

export {};
