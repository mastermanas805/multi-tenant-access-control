import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Request, type Response } from 'express';

import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@kernel/core';

/** The section-8.1 error envelope. Every 4xx/5xx response uses this shape. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    reason?: string;
    decisionId?: string;
    traceId?: string;
  };
}

/**
 * Maps thrown errors to HTTP + the DESIGN §8.1 error envelope:
 *   { error: { code, message, reason, decisionId?, traceId } }
 *
 * Mapping rules:
 *   - DomainError subclasses -> their stable `code` + the status below.
 *   - NestJS HttpException    -> its status; code derived from the status.
 *   - anything else          -> 500 internal_error (message hidden in prod).
 *
 * The domain layer never imports HTTP; this filter is the single translation point.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = request.traceId;

    const { status, envelope } = this.toHttp(exception, traceId);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ traceId, err: exception }, `Unhandled error: ${envelope.error.message}`);
    }

    response.status(status).json(envelope);
  }

  private toHttp(
    exception: unknown,
    traceId: string | undefined,
  ): { status: number; envelope: ErrorEnvelope } {
    if (exception instanceof DomainError) {
      return {
        status: this.statusForDomainError(exception),
        envelope: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.reason ? { reason: exception.reason } : {}),
            ...(exception.decisionId ? { decisionId: exception.decisionId } : {}),
            ...(traceId ? { traceId } : {}),
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message = this.extractHttpMessage(res, exception.message);
      return {
        status,
        envelope: {
          error: {
            code: this.codeForStatus(status),
            message,
            ...(traceId ? { traceId } : {}),
          },
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      envelope: {
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred',
          ...(traceId ? { traceId } : {}),
        },
      },
    };
  }

  private statusForDomainError(error: DomainError): number {
    if (error instanceof NotFoundError) {
      return HttpStatus.NOT_FOUND;
    }
    if (error instanceof ConflictError) {
      return HttpStatus.CONFLICT;
    }
    if (error instanceof ValidationError) {
      return HttpStatus.BAD_REQUEST;
    }
    if (error instanceof ForbiddenError) {
      return HttpStatus.FORBIDDEN;
    }
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'validation_failed';
      case HttpStatus.UNAUTHORIZED:
        return 'unauthenticated';
      case HttpStatus.FORBIDDEN:
        return 'forbidden';
      case HttpStatus.NOT_FOUND:
        return 'not_found';
      case HttpStatus.CONFLICT:
        return 'conflict';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'rate_limited';
      default:
        return status >= 500 ? 'internal_error' : 'error';
    }
  }

  private extractHttpMessage(res: string | object, fallback: string): string {
    if (typeof res === 'string') {
      return res;
    }
    const body = res as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      return body.message.join('; ');
    }
    return body.message ?? fallback;
  }
}
