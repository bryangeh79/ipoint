import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  ForbiddenException,
  Inject,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RequestActor } from '../auth/auth.types.js';
import { AuditService } from '../platform-access/audit.service.js';

/**
 * P7-S5C denied-sensitive-access audit filter.
 *
 * The P7-S0 frozen contract §6.4 requires "an audit record for every view",
 * and the P7-S5C order additionally requires that DENIED sensitive access is
 * audited (who, what, when, why denied). Guard-level denials (permission,
 * market, recorded reason, step-up) are raised by the canonical P7-S2
 * RbacGuard before the controller method runs, so the adapter audits them
 * here: this controller-scoped filter catches the guard's denial exceptions
 * on every `/admin/kyc-ops/**` route, writes one immutable privileged audit
 * record with `result: 'DENIED'`, and then serializes the identical error
 * contract the application's global `AllExceptionsFilter` would produce.
 *
 * Denials are never silently dropped and the audit write never blocks the
 * denial response: if the audit append fails the filter logs and still
 * returns the denial (fail-open for observability, fail-closed for access).
 */

const DENIAL_CODES = new Set([
  'PERMISSION_DENIED',
  'MARKET_ACCESS_DENIED',
  'MARKET_SELECTION_REQUIRED',
  'MARKET_CONTEXT_MISMATCH',
  'SENSITIVE_VIEW_REASON_REQUIRED',
  'MFA_STEP_UP_REQUIRED',
  'ADMIN_KYC_MARKET_ACCESS_DENIED',
  'ADMIN_MERCHANT_MARKET_ACCESS_DENIED',
]);

interface DenialContext {
  action: string;
  entityType: string;
  entityId: string;
}

@Catch(ForbiddenException, UnprocessableEntityException, ConflictException)
export class AdminKycDeniedAuditFilter implements ExceptionFilter {
  private readonly logger = new Logger(AdminKycDeniedAuditFilter.name);

  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const httpStatus =
      exception instanceof ForbiddenException ||
      exception instanceof UnprocessableEntityException ||
      exception instanceof ConflictException
        ? exception.getStatus()
        : 500;
    const body = serializeError(exception, request);

    const denial = denialContext(request, exception);
    if (denial) {
      await this.auditDenied(request, denial, body.error.code, exception);
    }

    response.status(httpStatus).json(body);
  }

  private async auditDenied(
    request: Request,
    denial: DenialContext,
    code: string,
    exception: unknown,
  ): Promise<void> {
    const actor = (request as Request & { actor?: RequestActor }).actor;
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) return;
    const marketContext = (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext;
    const requestId = (request as unknown as Record<string, string>)[
      'requestId'
    ];
    const failure = exception;
    try {
      await this.audit.recordPrivilegedAction({
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: denial.action,
        entity: { type: denial.entityType, id: denial.entityId },
        marketId: marketContext?.marketId,
        result: 'DENIED',
        reason: `${code}: ${errorMessage(failure)}`,
        requestId,
        ipAddress: request.ip,
        summary: `Sensitive KYC access denied (${code}) on ${request.method} ${request.originalUrl ?? request.url}.`,
      });
    } catch (auditError) {
      this.logger.error(
        {
          actorId: actor.adminUserId,
          action: denial.action,
          code,
          message:
            auditError instanceof Error
              ? auditError.message
              : 'Unknown audit failure',
        },
        'Denied-access audit append failed',
      );
    }
  }
}

function errorMessage(exception: unknown): string {
  if (
    exception instanceof ForbiddenException ||
    exception instanceof UnprocessableEntityException ||
    exception instanceof ConflictException
  ) {
    const responseBody = exception.getResponse();
    if (typeof responseBody === 'object' && responseBody !== null) {
      const message = (responseBody as Record<string, unknown>)['message'];
      if (typeof message === 'string') return message;
    }
  }
  return exception instanceof Error ? exception.message : 'Access denied';
}

/**
 * Derive the denied audit context (who/what) from the route being denied.
 * The route pattern is taken from Express `route.path` when available so the
 * entity id comes from the named params without hand-rolled URL parsing.
 */
function denialContext(
  request: Request,
  exception: unknown,
): DenialContext | null {
  const body = errorBody(exception);
  if (!body || !DENIAL_CODES.has(body.code)) return null;

  const routePath: string | undefined =
    (request.route as { path?: string } | undefined)?.path ??
    normalizedUrlPath(request);
  const params = request.params as Record<string, string | undefined>;
  const marketId =
    (
      request as Request & {
        adminMarketContext?: { marketId: string };
      }
    ).adminMarketContext?.marketId ?? params['marketId'];

  const memberCase = params['id'];
  const merchantBranch = params['branchId'];

  const isMerchant = routePath?.includes('/merchants') ?? false;
  const isMember = routePath?.includes('/members') ?? false;

  if (isMerchant) {
    if (routePath?.endsWith('/evidence')) {
      return {
        action: 'merchant.kyc.ops.evidence.view',
        entityType: 'merchant_branch',
        entityId: merchantBranch ?? 'unknown',
      };
    }
    if (routePath?.endsWith('/review')) {
      return {
        action: 'merchant.kyc.ops.decide',
        entityType: 'merchant_branch',
        entityId: merchantBranch ?? 'unknown',
      };
    }
    if (merchantBranch) {
      return {
        action: 'merchant.kyc.ops.view',
        entityType: 'merchant_branch',
        entityId: merchantBranch,
      };
    }
    return {
      action: 'merchant.kyc.ops.queue.view',
      entityType: 'kyc_queue',
      entityId: marketId ?? 'unknown',
    };
  }

  if (isMember) {
    if (routePath?.endsWith('/evidence')) {
      return {
        action: 'member.kyc.ops.evidence.view',
        entityType: 'member_kyc_case',
        entityId: memberCase ?? 'unknown',
      };
    }
    if (memberCase) {
      // Non-evidence member routes are either the masked detail read or the
      // review actions (start-review/request-more-info/approve/reject/
      // require-reverification).
      const action =
        routePath?.endsWith('/start-review') ||
        routePath?.endsWith('/request-more-info') ||
        routePath?.endsWith('/approve') ||
        routePath?.endsWith('/reject') ||
        routePath?.endsWith('/require-reverification')
          ? 'member.kyc.ops.decide'
          : 'member.kyc.ops.view';
      return {
        action,
        entityType: 'member_kyc_case',
        entityId: memberCase,
      };
    }
    return {
      action: 'member.kyc.ops.queue.view',
      entityType: 'kyc_queue',
      entityId: marketId ?? 'unknown',
    };
  }

  return {
    action: 'admin.kyc.ops.denied',
    entityType: 'kyc_queue',
    entityId: marketId ?? 'unknown',
  };
}

/** Strip the global API prefix and query string for route-pattern matching. */
function normalizedUrlPath(request: Request): string | undefined {
  const source = request.originalUrl ?? request.url ?? '';
  const queryIndex = source.indexOf('?');
  const pathname = queryIndex >= 0 ? source.slice(0, queryIndex) : source;
  const prefix = '/api/v1';
  const path = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length)
    : pathname;
  return path.length > 0 ? path : undefined;
}

function errorBody(
  exception: unknown,
): { code: string; message?: string; details?: unknown } | null {
  if (
    exception instanceof ForbiddenException ||
    exception instanceof UnprocessableEntityException ||
    exception instanceof ConflictException
  ) {
    const responseBody = exception.getResponse();
    if (typeof responseBody === 'string') {
      return { code: `HTTP_${exception.getStatus()}`, message: responseBody };
    }
    if (typeof responseBody === 'object' && responseBody !== null) {
      const record = responseBody as Record<string, unknown>;
      return {
        code:
          typeof record['code'] === 'string'
            ? record['code']
            : `HTTP_${exception.getStatus()}`,
        message:
          typeof record['message'] === 'string'
            ? record['message']
            : exception.message,
        ...(record['details'] !== undefined
          ? { details: record['details'] }
          : {}),
      };
    }
    return { code: `HTTP_${exception.getStatus()}` };
  }
  return null;
}

/** Serialize exactly like the application's AllExceptionsFilter. */
function serializeError(
  exception: unknown,
  request: Request,
): {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
  timestamp: string;
} {
  const requestId =
    (request as unknown as Record<string, string>)['requestId'] ?? 'unknown';
  const body = errorBody(exception) ?? {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
  return {
    error: {
      code: body.code,
      message: body.message ?? 'An unexpected error occurred',
      ...(body.details !== undefined ? { details: body.details } : {}),
    },
    requestId,
    timestamp: new Date().toISOString(),
  };
}
