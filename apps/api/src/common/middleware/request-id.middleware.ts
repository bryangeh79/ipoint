import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Middleware that ensures every request has a request ID.
 * - Reads `x-request-id` from the incoming request header, or generates one.
 * - Sets `x-request-id` on the response header.
 * - Attaches the request ID to `req.requestId` for downstream use.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    (req as Record<string, unknown>)['requestId'] = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}
