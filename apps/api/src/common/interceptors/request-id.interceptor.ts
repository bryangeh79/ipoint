import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';

/**
 * Ensures every request has a request ID.
 * - Reads `x-request-id` from the incoming request header, or generates one.
 * - Sets `x-request-id` on the response header.
 * - Attaches the request ID to the request object for downstream use.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    (req as Record<string, unknown>)['requestId'] = requestId;
    res.setHeader('x-request-id', requestId);

    return next.handle();
  }
}
