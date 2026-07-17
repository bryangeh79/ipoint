import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RbacService } from './rbac.service.js';

interface PermissionRequirement {
  permission: string;
  marketScoped: boolean;
}

const permissionRequirementKey = 'ipoint:permission-requirement';

export const RequirePermission = (
  permission: string,
  options: { marketScoped?: boolean } = {},
) =>
  SetMetadata(permissionRequirementKey, {
    permission,
    marketScoped: options.marketScoped ?? false,
  } satisfies PermissionRequirement);

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      permissionRequirementKey,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return this.deny();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const adminUserId = request.actor?.adminUserId;
    if (!adminUserId) return this.deny();
    const marketId = requirement.marketScoped
      ? resolveMarketId(request)
      : undefined;
    if (requirement.marketScoped && !marketId) return this.deny();
    const allowed = await this.rbac.isAllowed({
      adminUserId,
      permission: requirement.permission,
    });
    if (!allowed) return this.deny();
    if (marketId && !(await this.rbac.hasMarketAccess(adminUserId, marketId)))
      return this.denyMarket();
    return true;
  }

  private deny(): never {
    throw new ForbiddenException({
      code: 'AUTH_PERMISSION_DENIED',
      message: 'Permission denied.',
    });
  }

  private denyMarket(): never {
    throw new ForbiddenException({
      code: 'AUTH_MARKET_ACCESS_DENIED',
      message: 'Market access denied.',
    });
  }
}

function resolveMarketId(request: AuthenticatedRequest): string | undefined {
  const routeMarket = request.params?.['marketId'];
  if (typeof routeMarket === 'string') return routeMarket;
  if (Array.isArray(routeMarket)) return routeMarket[0];
  const header = request.headers['x-market-id'];
  return Array.isArray(header) ? header[0] : header;
}
