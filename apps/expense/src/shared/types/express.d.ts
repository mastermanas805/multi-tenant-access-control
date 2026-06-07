/**
 * Express Request augmentation for the Expense service.
 *
 * The PEP toolkit (`@authz/pep`) already augments Express's Request with
 * `authzPrincipal`, `authzDecision` and `traceId` (see its
 * `express-augmentation.ts`). We re-declare `traceId` here as the service's own
 * request-context middleware (request-context.ts) is what SETS it — declaration
 * merging unions the field with the PEP's, so a consumer that loads either gets a
 * type-safe `req.traceId`.
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
