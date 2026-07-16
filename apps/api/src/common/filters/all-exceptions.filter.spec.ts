import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import type { Request, Response } from 'express';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockHost: ArgumentsHost;
  let statusSpy: ReturnType<typeof vi.fn>;
  let jsonSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');

    filter = new AllExceptionsFilter();
    statusSpy = vi.fn().mockReturnThis();
    jsonSpy = vi.fn().mockReturnThis();

    mockRequest = {
      url: '/api/v1/test',
      method: 'GET',
    } as Partial<Request>;
    (mockRequest as unknown as Record<string, unknown>)['requestId'] =
      'test-request-id';

    mockResponse = {
      status: statusSpy,
      json: jsonSpy,
    } as Partial<Response>;

    mockHost = {
      switchToHttp: () => ({
        getRequest: () => mockRequest as Request,
        getResponse: () => mockResponse as Response,
      }),
    } as ArgumentsHost;
  });

  it('should handle HttpException', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    filter.catch(exception, mockHost);

    expect(statusSpy).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'HTTP_404',
          message: 'Not Found',
        },
        requestId: 'test-request-id',
        timestamp: expect.any(String) as unknown,
      }),
    );
  });

  it('should handle HttpException with object response', () => {
    const exception = new HttpException(
      { message: 'Validation failed', code: 'VALIDATION_ERROR' },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, mockHost);

    expect(statusSpy).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
        requestId: 'test-request-id',
      }),
    );
  });

  it('normalizes Nest validation message arrays', () => {
    const exception = new HttpException(
      { message: ['name must be a string'], error: 'Bad Request' },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, mockHost);

    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'HTTP_400',
          message: 'Validation failed',
          details: ['name must be a string'],
        },
      }),
    );
  });

  it('should handle generic Error with safe message in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const exception = new Error('Internal database failure');
    filter.catch(exception, mockHost);

    expect(statusSpy).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
        requestId: 'test-request-id',
      }),
    );
  });

  it('should include error details in development mode', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const exception = new Error('Developer details');
    filter.catch(exception, mockHost);

    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          details: {
            name: 'Error',
            message: 'Developer details',
          },
        }) as unknown,
      }),
    );
  });

  it('should not include stack traces in error details', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const exception = new Error('No stack trace');
    filter.catch(exception, mockHost);

    const callArg = jsonSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const details = (callArg.error as Record<string, unknown>)
      .details as Record<string, unknown>;
    expect(details).not.toHaveProperty('stack');
  });

  it('should use unknown requestId when not present', () => {
    (mockRequest as unknown as Record<string, unknown>)['requestId'] =
      undefined;
    const exception = new HttpException('Bad', HttpStatus.BAD_REQUEST);
    filter.catch(exception, mockHost);

    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'unknown',
      }),
    );
  });
});
