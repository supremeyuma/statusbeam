import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { getRequestId, sanitizeRequestId } from '../request-context';

export interface ErrorEnvelope {
  statusCode: number;
  message: string | string[];
  error: string;
  requestId: string;
  path: string;
  timestamp: string;
}

function extractMessage(
  exception: unknown,
  status: number,
): { message: string | string[]; error: string } {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return { message: response, error: HttpStatus[status] ?? 'Error' };
    }
    if (typeof response === 'object' && response !== null) {
      const body = response as { message?: unknown; error?: unknown };
      const message =
        typeof body.message === 'string' || Array.isArray(body.message)
          ? (body.message as string | string[])
          : exception.message;
      const error = typeof body.error === 'string' ? body.error : (HttpStatus[status] ?? 'Error');
      return { message, error };
    }
  }

  return {
    message: status >= 500 ? 'Internal server error' : 'Request failed',
    error: HttpStatus[status] ?? 'Error',
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType<'http'>() !== 'http') {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const { message, error } = extractMessage(exception, status);
    const requestId =
      getRequestId() ??
      sanitizeRequestId(typeof request.id === 'string' ? request.id : undefined) ??
      sanitizeRequestId(request.header('x-request-id')) ??
      'unknown';

    const envelope: ErrorEnvelope = {
      statusCode: status,
      message,
      error,
      requestId,
      path: request.originalUrl || request.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${envelope.path} -> ${status} (${requestId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(`${request.method} ${envelope.path} -> ${status} (${requestId})`);
    }

    if (!response.headersSent) {
      response.status(status).json(envelope);
    }
  }
}
