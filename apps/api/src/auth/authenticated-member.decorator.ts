import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';

/**
 * Extracts the authenticated member identity from the request principal.
 *
 * Validates that the actor is an ACCOUNT type (not ADMIN_USER) and returns
 * the accountId from the resolved auth token.
 *
 * ## Rule
 * - Auth from principal — never from request body.
 *
 * @throws UnauthorizedException if the actor is missing or not an ACCOUNT
 */
export const AuthenticatedMember = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = request.actor;

    if (!actor || actor.type !== 'ACCOUNT' || !actor.accountId) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_INVALID',
        message: 'A valid member session is required.',
      });
    }

    return actor.accountId;
  },
);
