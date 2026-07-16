import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function resolveRequestId(
  headerValue: string | string[] | undefined,
): string {
  return typeof headerValue === 'string' && headerValue.trim().length > 0
    ? headerValue
    : uuidv4();
}

/**
 * Middleware that ensures every request has a request ID.
 * - Reads `x-request-id` from the incoming request header, or generates one.
 * - Sets `x-request-id` on the response header.
 * - Attaches the request ID to `req.requestId` for downstream use.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const existingRequestId = (req as unknown as Record<string, unknown>)[
      'requestId'
    ];
    const requestId =
      typeof existingRequestId === 'string'
        ? existingRequestId
        : resolveRequestId(req.headers['x-request-id']);
    (req as unknown as Record<string, unknown>)['requestId'] = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}
