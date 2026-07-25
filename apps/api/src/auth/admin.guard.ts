import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from './auth.guard.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AuthGuard) private readonly authGuard: AuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const baseResult = await this.authGuard.canActivate(context);
    if (!baseResult) return false;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = request.actor;
    if (!actor || actor.type !== 'ADMIN_USER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
    }
    return true;
  }
}
