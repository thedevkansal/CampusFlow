/**
 * GlobalExceptionFilter — catches all unhandled exceptions and formats them
 * into the standard API error response shape defined in docs/API_CONTRACTS.md:
 *
 * { success: false, error: string, code: string }
 *
 * All exceptions are:
 * 1. Logged via Winston
 * 2. Reported to Sentry (non-4xx errors only)
 * 3. Returned to the client in the standard format
 *
 * Source: docs/API_CONTRACTS.md — Error Format
 *         docs/ENGINEERING_RULES.md — "Every major action must be traceable"
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';

interface ErrorBody {
  success: false;
  error: string;
  code: string;
  statusCode: number;
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();

    let httpStatus: number;
    let errorMessage: string;
    let errorCode: string;

    if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'string') {
        errorMessage = response;
        errorCode = this.statusToCode(httpStatus);
      } else if (typeof response === 'object' && response !== null) {
        const resp = response as Record<string, unknown>;
        errorMessage =
          Array.isArray(resp['message'])
            ? (resp['message'] as string[]).join('; ')
            : String(resp['message'] ?? exception.message);
        errorCode = String(resp['code'] ?? this.statusToCode(httpStatus));
      } else {
        errorMessage = exception.message;
        errorCode = this.statusToCode(httpStatus);
      }
    } else {
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      errorMessage = 'An unexpected error occurred';
      errorCode = 'INTERNAL_SERVER_ERROR';

      // Only log and report unexpected errors
      this.logger.error('Unhandled exception', {
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
        path: request.url,
        method: request.method,
      });

      Sentry.captureException(exception);
    }

    // Log 5xx errors
    if (httpStatus >= 500) {
      this.logger.error(`${request.method} ${request.url} → ${httpStatus}`, {
        code: errorCode,
        error: errorMessage,
      });
    } else if (httpStatus >= 400) {
      this.logger.warn(`${request.method} ${request.url} → ${httpStatus}`, {
        code: errorCode,
      });
    }

    const responseBody: ErrorBody = {
      success: false,
      error: errorMessage,
      code: errorCode,
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(ctx.getRequest()) as string,
    };

    httpAdapter.reply(ctx.getResponse<Response>(), responseBody, httpStatus);
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'AUTH_INVALID_TOKEN',
      403: 'AUTHZ_FORBIDDEN',
      404: 'RESOURCE_NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_SERVER_ERROR',
    };
    return map[status] ?? `HTTP_${status}`;
  }
}
