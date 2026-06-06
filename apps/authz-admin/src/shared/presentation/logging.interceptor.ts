import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { type Request } from 'express';
import { type Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Structured access logging: logs method, path, status latency and traceId for
 * each request. Keeps log lines machine-parseable (one JSON object per line via
 * the Nest logger configured in main.ts).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log({
            method,
            url,
            traceId: request.traceId,
            durationMs: Date.now() - start,
          });
        },
        error: () => {
          this.logger.warn({
            method,
            url,
            traceId: request.traceId,
            durationMs: Date.now() - start,
            outcome: 'error',
          });
        },
      }),
    );
  }
}
