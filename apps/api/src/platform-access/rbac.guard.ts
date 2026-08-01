import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { permissionDefinition } from '@ipoint/database';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RbacService } from './rbac.service.js';

interface PermissionRequirement {
  permission: string;
  marketScoped?: boolean;
  stepUpRequired?: boolean;
  sensitiveReasonRequired?: boolean;
  targetParams?: string[];
  targetBodyFields?: string[];
}

const permissionRequirementKey = 'ipoint:permission-requirement';

export const RequirePermission = (
  permission: string,
  options: Omit<PermissionRequirement, 'permission'> = {},
) =>
  SetMetadata(permissionRequirementKey, {
    permission,
    ...options,
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
    const sessionId = request.actor?.sessionId;
    if (!adminUserId || !sessionId) return this.deny();
    const definition = permissionDefinition(requirement.permission);
    if (!definition) return this.deny();
    const marketScoped = requirement.marketScoped ?? definition.marketScoped;
    const stepUpRequired =
      requirement.stepUpRequired ?? definition.stepUpRequired;
    const sensitiveReasonRequired =
      requirement.sensitiveReasonRequired ??
      definition.sensitiveReasonRequired ??
      false;
    const allowed = await this.rbac.isAllowed({
      adminUserId,
      permission: requirement.permission,
    });
    if (!allowed) return this.deny();
    let marketId: string | undefined;
    if (marketScoped) {
      const current = await this.rbac.resolveCurrentMarket(
        adminUserId,
        sessionId,
      );
      if (!current?.marketId) return this.selectionRequired();
      marketId = current.marketId;
      if (!(await this.rbac.hasMarketAccess(adminUserId, marketId))) {
        return this.denyMarket();
      }
      this.assertMarketConsistency(request, marketId);
      request.headers['x-market-id'] = marketId;
      (
        request as AuthenticatedRequest & {
          adminMarketContext?: { marketId: string; contextVersion: number };
        }
      ).adminMarketContext = {
        marketId,
        contextVersion: current.contextVersion,
      };
    }
    if (sensitiveReasonRequired) {
      const reason = firstHeader(request, 'x-sensitive-access-reason')?.trim();
      if (!reason || reason.length < 8 || reason.length > 500) {
        throw new UnprocessableEntityException({
          code: 'SENSITIVE_VIEW_REASON_REQUIRED',
          message: 'Enter a reason to view this information.',
        });
      }
    }
    if (
      stepUpRequired &&
      !(await this.rbac.consumeStepUpGrant({
        token: firstHeader(request, 'x-step-up-token'),
        sessionId,
        adminUserId,
        permission: requirement.permission,
        marketId,
        target: resolveTarget(request, requirement),
      }))
    ) {
      throw new ForbiddenException({
        code: 'MFA_STEP_UP_REQUIRED',
        message: 'Verify your identity again to continue.',
      });
    }
    return true;
  }

  private deny(): never {
    throw new ForbiddenException({
      code: 'PERMISSION_DENIED',
      message: 'You do not have permission for this action.',
    });
  }

  private denyMarket(): never {
    throw new ForbiddenException({
      code: 'MARKET_ACCESS_DENIED',
      message: 'You do not have access to this market.',
    });
  }

  private selectionRequired(): never {
    throw new ConflictException({
      code: 'MARKET_SELECTION_REQUIRED',
      message: 'Select an authorized market to continue.',
    });
  }

  private assertMarketConsistency(
    request: AuthenticatedRequest,
    marketId: string,
  ): void {
    const candidates = [
      routeValue(request, 'marketId'),
      firstHeader(request, 'x-market-id'),
      bodyValue(request, 'marketId'),
      bodyValue(request, 'market_id'),
    ].filter((value): value is string => Boolean(value));
    if (candidates.some((candidate) => candidate !== marketId)) {
      throw new ConflictException({
        code: 'MARKET_CONTEXT_MISMATCH',
        message: 'The selected market changed. Refresh and try again.',
      });
    }
  }
}

function resolveTarget(
  request: AuthenticatedRequest,
  requirement: PermissionRequirement,
): string | undefined {
  const values = [
    ...(requirement.targetParams ?? []).map((key) => routeValue(request, key)),
    ...(requirement.targetBodyFields ?? []).map((key) =>
      bodyValue(request, key),
    ),
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(':') : undefined;
}

function routeValue(
  request: AuthenticatedRequest,
  key: string,
): string | undefined {
  const value = request.params?.[key];
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value[0] : undefined;
}

function bodyValue(
  request: AuthenticatedRequest,
  key: string,
): string | undefined {
  const body = request.body as Record<string, unknown> | undefined;
  const value = body?.[key];
  return typeof value === 'string' ? value : undefined;
}

function firstHeader(
  request: AuthenticatedRequest,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
