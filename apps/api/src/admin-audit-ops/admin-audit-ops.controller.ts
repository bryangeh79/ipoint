import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import type { AuditListQueryDto } from './admin-audit-ops.dto.js';
import { auditListQuerySchema } from './admin-audit-ops.dto.js';
import { AdminAuditOpsService } from './admin-audit-ops.service.js';
import {
  AuditViewerError,
  type AuditEntryRawView,
  type AuditEntryView,
  type AuditListResponse,
  type AuditViewerActor,
} from './admin-audit-ops.types.js';

/**
 * P7-S9 Audit Viewer adapter endpoints (Command Center 2026-08-07 §7.1).
 *
 * - `GET .../entries` — market-scoped, filterable/searchable, masked audit
 *   list (`audit.read`, marketScoped; ALL controlled roles incl. Support).
 * - `GET .../entries/:entryId` — one masked entry (`audit.read`).
 * - `GET .../entries/:entryId/raw` — full stored evidence (`audit.
 *   sensitive-diff.view`, marketScoped, step-up + recorded reason enforced
 *   by the RbacGuard). The Support template is NOT granted this
 *   permission: support never reads raw ledgers.
 *
 * Market contract: canonical RbacGuard (all permissions marketScoped) — the
 * URL market must equal the server-owned Current Admin Market and the actor
 * must hold the market grant (409 `MARKET_CONTEXT_MISMATCH` otherwise).
 * Read-only by construction: GET endpoints only, no writes, no export.
 */
@ApiTags('Admin Audit Viewer')
@ApiBearerAuth()
@Controller('admin/audit-ops')
@UseGuards(AuthGuard, RbacGuard)
export class AdminAuditOpsController {
  constructor(
    @Inject(AdminAuditOpsService)
    private readonly audit: AdminAuditOpsService,
  ) {}

  @Get('markets/:marketId/entries')
  @RequirePermission('audit.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Selected-market masked audit list with filters and search.',
    description:
      'Read-only projection of the immutable audit_logs table for the Current Admin Market. Supports actor/action/entity/result filters, an ISO-8601 time range, free-text search and bounded pagination. Evidence fields are masked (sensitive keys redacted, identity-document fields masked, source IP never returned); the raw view is a separate permissioned endpoint. Read-only: no writes, no export.',
  })
  @ApiResponse({ status: 200, description: 'Masked audit entries.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  listEntries(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(auditListQuerySchema))
    query: AuditListQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ): Promise<AuditListResponse> {
    return this.handle(() =>
      this.audit.listEntries(this.actor(actor, request), marketId, query),
    );
  }

  @Get('markets/:marketId/entries/:entryId')
  @RequirePermission('audit.read', { marketScoped: true })
  @ApiOperation({
    summary: 'One masked audit entry.',
    description:
      'Masked limited view of a single immutable audit entry. 404 when the entry does not exist in the Current Admin Market.',
  })
  @ApiResponse({ status: 200, description: 'Masked audit entry.' })
  @ApiResponse({ status: 404, description: 'Entry not found in market.' })
  getEntry(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ): Promise<AuditEntryView> {
    return this.handle(() =>
      this.audit.getEntry(this.actor(actor, request), marketId, entryId),
    );
  }

  @Get('markets/:marketId/entries/:entryId/raw')
  @RequirePermission('audit.sensitive-diff.view', { marketScoped: true })
  @ApiOperation({
    summary: 'Raw audit evidence view (audited raw view).',
    description:
      'Full stored evidence (before/after, source IP, request id) for one immutable audit entry. Requires audit.sensitive-diff.view: the RbacGuard enforces the recorded sensitive-access reason and a fresh MFA step-up grant, and the Support template is not granted this permission (support never reads raw ledgers). Read-only; the view performs no writes.',
  })
  @ApiResponse({ status: 200, description: 'Raw audit evidence.' })
  @ApiResponse({
    status: 403,
    description: 'Permission, reason or step-up denied.',
  })
  @ApiResponse({ status: 404, description: 'Entry not found in market.' })
  getRawEntry(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ): Promise<AuditEntryRawView> {
    return this.handle(() =>
      this.audit.getRawEntry(this.actor(actor, request), marketId, entryId),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private actor(
    actor: RequestActor | undefined,
    request: Request,
  ): AuditViewerActor {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      });
    }
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
    return {
      adminUserId: actor.adminUserId,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AuditViewerError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'AUDIT_ENTRY_NOT_FOUND':
          throw new NotFoundException(body);
        default:
          throw new UnprocessableEntityException(body);
      }
    }
  }
}
