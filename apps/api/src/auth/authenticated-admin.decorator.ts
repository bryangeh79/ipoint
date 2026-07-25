import {
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';

/**
 * Extracts the authenticated admin user identity from the request principal.
 *
 * Validates that the actor is an ADMIN_USER type (not ACCOUNT) and returns
 * the adminUserId from the resolved auth token.
 *
 * ## Rule
 * - Auth from principal — never from request body.
 *
 * @throws ForbiddenException if the actor is missing or not an ADMIN_USER
 */
export const AuthenticatedAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = request.actor;

    if (!actor || actor.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'AUTH_PERMISSION_DENIED',
        message: 'An administrator session is required.',
      });
    }

    return actor.adminUserId;
  },
);
