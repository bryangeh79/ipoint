import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId =
      (request as unknown as Record<string, string>)['requestId'] ?? 'unknown';
    const timestamp = new Date().toISOString();

    let httpStatus: number;
    let errorCode: string;
    let errorMessage: string;
    let errorDetails: unknown;

    if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        errorCode = `HTTP_${httpStatus}`;
        errorMessage = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        errorCode =
          typeof resp['code'] === 'string'
            ? resp['code']
            : `HTTP_${httpStatus}`;
        if (typeof resp['message'] === 'string') {
          errorMessage = resp['message'];
        } else if (Array.isArray(resp['message'])) {
          errorMessage = 'Validation failed';
        } else {
          errorMessage = exception.message;
        }
        errorDetails =
          resp['details'] ??
          (Array.isArray(resp['message']) ? resp['message'] : undefined);
      } else {
        errorCode = `HTTP_${httpStatus}`;
        errorMessage = exception.message;
      }
    } else if (exception instanceof Error) {
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      errorCode = 'INTERNAL_ERROR';
      errorMessage = 'An unexpected error occurred';
      errorDetails =
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
          ? { name: exception.name, message: exception.message }
          : undefined;

      this.logger.error(
        {
          errorName: exception.name,
          errorMessage: exception.message,
          requestId,
          url: request.url,
          method: request.method,
        },
        exception.stack,
      );
    } else {
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      errorCode = 'INTERNAL_ERROR';
      errorMessage = 'An unexpected error occurred';

      this.logger.error(
        { requestId, url: request.url, method: request.method, exception },
        'Unknown exception type',
      );
    }

    const body: ErrorResponseBody = {
      error: {
        code: errorCode,
        message: errorMessage,
        ...(errorDetails !== undefined ? { details: errorDetails } : {}),
      },
      requestId,
      timestamp,
    };

    response.status(httpStatus).json(body);
  }
}
