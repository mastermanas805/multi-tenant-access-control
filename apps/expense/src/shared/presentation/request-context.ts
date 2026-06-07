import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';

/** Header name carrying the correlation/trace id across services. */
export const TRACE_ID_HEADER = 'x-trace-id';

/**
 * Assigns a trace id to every request (honoring an inbound x-trace-id so traces
 * span services) and echoes it on the response. The id flows into logs, into the
 * section-8.1 error envelope's `traceId`, and into the DecisionAuditRecord the PEP
 * emits (DESIGN §8.7) so a decision can be correlated across the call chain.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  public use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers[TRACE_ID_HEADER];
    const traceId = (Array.isArray(inbound) ? inbound[0] : inbound) ?? `trc_${randomUUID()}`;
    req.traceId = traceId;
    res.setHeader(TRACE_ID_HEADER, traceId);
    next();
  }
}
