import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { RequestActor } from './auth.types.js';

export interface AuthenticatedRequest extends Request {
  actor?: RequestActor;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_INVALID',
        message: 'Authentication is required.',
      });
    }
    try {
      request.actor = await this.auth.resolveActor(authorization.slice(7));
      return true;
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_INVALID',
        message: 'Authentication is required.',
      });
    }
  }
}
