import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { RequestIdMiddleware } from './request-id.middleware.js';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFn: ReturnType<typeof vi.fn>;
  let setHeaderSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    setHeaderSpy = vi.fn();
    nextFn = vi.fn();

    mockRequest = {
      headers: {},
    } as Partial<Request>;

    mockResponse = {
      setHeader: setHeaderSpy,
    } as Partial<Response>;
  });

  it('should generate a request ID if x-request-id is not provided', () => {
    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    const requestId = (mockRequest as unknown as Record<string, unknown>)['requestId'];
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe('string');
    expect(setHeaderSpy).toHaveBeenCalledWith('x-request-id', requestId);
    expect(nextFn).toHaveBeenCalledOnce();
  });

  it('should use the incoming x-request-id header', () => {
    const incomingId = 'incoming-request-id-123';
    mockRequest.headers = { 'x-request-id': incomingId };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    const requestId = (mockRequest as unknown as Record<string, unknown>)['requestId'];
    expect(requestId).toBe(incomingId);
    expect(setHeaderSpy).toHaveBeenCalledWith('x-request-id', incomingId);
  });

  it('should generate a UUID v4 format by default', () => {
    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    const requestId = (mockRequest as unknown as Record<string, unknown>)['requestId'] as string;
    // UUID v4 format: 8-4-4-4-12 hex characters
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should set the response header x-request-id', () => {
    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFn,
    );

    const requestId = (mockRequest as unknown as Record<string, unknown>)['requestId'];
    expect(setHeaderSpy).toHaveBeenCalledWith('x-request-id', requestId);
  });
});
