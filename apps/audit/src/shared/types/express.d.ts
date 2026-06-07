/**
 * Express Request augmentation for the Audit service.
 *
 * The service's own request-context middleware (request-context.ts) sets
 * `req.traceId`; declaration merging exposes it type-safely to the logging
 * interceptor and the section-8.1 global exception filter. Mirrors the
 * convention in apps/expense/src/shared/types/express.d.ts.
 */
import 'express';

import { type AuthzPrincipalContext } from '@authz/pep';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id (set by RequestContextMiddleware). */
      traceId?: string;
      /**
       * The VERIFIED principal context the PEP's IdentityContextMiddleware sets on
       * the audit READ routes from the gateway-signed internal token (tenant/actor/
       * platform-admin). The read controller scopes the decision log to this
       * tenant, never a client `?tenantId=` (DESIGN §6/§7). Undefined on routes the
       * middleware does not cover (health, the ingest POST).
       */
      authzPrincipal?: AuthzPrincipalContext;
    }
  }
}

export {};
