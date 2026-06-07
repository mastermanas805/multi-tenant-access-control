import 'express';

import { type PdpActionResult } from '@contracts/core';

import { type AuthzPrincipalContext } from './authz-request-context';

/** The ALLOW decision the guard exposes so a handler can echo the decisionId (DESIGN §8.2). */
export interface AuthzDecisionContext {
  readonly decisionId: string;
  readonly results: PdpActionResult[];
}

/**
 * Ambient augmentation so the PEP can attach the principal context + per-request
 * trace id onto Express's Request type-safely. A consuming service that already
 * augments `traceId` (e.g. via its own request-context middleware) is compatible —
 * declaration merging unions the fields.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by IdentityContextMiddleware from the internal identity token. */
      authzPrincipal?: AuthzPrincipalContext;
      /** Set by AuthzGuard on ALLOW so the handler can echo the decisionId. */
      authzDecision?: AuthzDecisionContext;
      /** Correlation id (set by the service's request-context middleware). */
      traceId?: string;
    }
  }
}

export {};
