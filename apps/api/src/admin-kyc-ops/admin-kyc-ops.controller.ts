import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminKycError } from '../admin-kyc/admin-kyc.errors.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import {
  memberKycOpsActionSchemas,
  memberKycOpsListQuerySchema,
  merchantKycOpsQueueQuerySchema,
  merchantKycOpsReviewSchema,
  type MemberKycOpsActionDto,
  type MemberKycOpsListQueryDto,
  type MerchantKycOpsQueueQueryDto,
  type MerchantKycOpsReviewDto,
} from './admin-kyc-ops.dto.js';
import { AdminKycOpsService } from './admin-kyc-ops.service.js';
import { AdminKycDeniedAuditFilter } from './admin-kyc-ops.denied.filter.js';
import { KycOpsError, type KycOpsActor } from './admin-kyc-ops.types.js';

/**
 * P7-S5C Admin KYC Operations adapter endpoints.
 *
 * Every route is market-scoped: the P7-S2 RbacGuard resolves the server-owned
 * Current Admin Market and rejects any client-supplied market disagreement.
 * The adapter then re-validates that the target case/submission's market IS
 * the selected market before delegating to the frozen Phase 2 member KYC
 * owner (`AdminKycService`) or the frozen Phase 1 merchant KYC owner
 * (`MerchantService`).
 *
 * Evidence rules (frozen contract §6.4): the plain detail endpoints return
 * masked summaries only; raw (minimum) evidence is served exclusively by the
 * `/evidence` endpoints behind the dedicated evidence permissions, which the
 * canonical guard gates with step-up MFA and a recorded sensitive-access
 * reason; every detail and evidence view is audited. No raw document content
 * is ever served or exportable on this surface.
 */
@ApiTags('Admin KYC Operations')
@ApiBearerAuth()
@Controller('admin/kyc-ops')
@UseGuards(AuthGuard, RbacGuard)
@UseFilters(AdminKycDeniedAuditFilter)
export class AdminKycOpsController {
  constructor(
    @Inject(AdminKycOpsService)
    private readonly ops: AdminKycOpsService,
  ) {}

  /* ── Member KYC ───────────────────────────────────────────────────── */

  @Get('members')
  @RequirePermission('member.kyc.read')
  @ApiOperation({
    summary: 'Selected-market member KYC queue (masked summaries).',
  })
  listMemberCases(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(memberKycOpsListQuerySchema))
    filters: MemberKycOpsListQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.listMemberCases(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        filters,
      ),
    );
  }

  @Get('members/:id')
  @RequirePermission('member.kyc.read')
  @ApiOperation({
    summary:
      'Member KYC case detail — masked identity/contact summary (audited).',
  })
  getMemberCase(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.getMemberCase(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        caseId,
      ),
    );
  }

  @Get('members/:id/evidence')
  @RequirePermission('member.kyc.evidence.view')
  @ApiOperation({
    summary:
      'Sensitive member KYC evidence (dedicated permission + reason + step-up; every view audited).',
  })
  getMemberCaseEvidence(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.getMemberCaseEvidence(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        caseId,
      ),
    );
  }

  @Post('members/:id/start-review')
  @RequirePermission('member.kyc.decide')
  @HttpCode(200)
  startReview(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(memberKycOpsActionSchemas['start-review']))
    input: MemberKycOpsActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.startReview(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        caseId,
        input,
        this.requireIdempotencyKey(idempotencyKey),
      ),
    );
  }

  @Post('members/:id/request-more-info')
  @RequirePermission('member.kyc.decide')
  @HttpCode(200)
  requestMoreInfo(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(memberKycOpsActionSchemas['request-more-info']))
    input: MemberKycOpsActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.requestMoreInfo(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        caseId,
        input,
        this.requireIdempotencyKey(idempotencyKey),
      ),
    );
  }

  @Post('members/:id/approve')
  @RequirePermission('member.kyc.decide')
  @HttpCode(200)
  approve(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(memberKycOpsActionSchemas['approve']))
    input: MemberKycOpsActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.approve(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        caseId,
        input,
        this.requireIdempotencyKey(idempotencyKey),
      ),
    );
  }

  @Post('members/:id/reject')
  @RequirePermission('member.kyc.decide')
  @HttpCode(200)
  reject(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(memberKycOpsActionSchemas['reject']))
    input: MemberKycOpsActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.reject(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        caseId,
        input,
        this.requireIdempotencyKey(idempotencyKey),
      ),
    );
  }

  @Post('members/:id/require-reverification')
  @RequirePermission('member.kyc.decide')
  @HttpCode(200)
  requireReverification(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(
      new ZodValidationPipe(
        memberKycOpsActionSchemas['require-reverification'],
      ),
    )
    input: MemberKycOpsActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.requireReverification(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        caseId,
        input,
        this.requireIdempotencyKey(idempotencyKey),
      ),
    );
  }

  /* ── Merchant KYC ─────────────────────────────────────────────────── */

  @Get('merchants')
  @RequirePermission('merchant.kyc.view')
  @ApiOperation({
    summary: 'Selected-market merchant KYC submissions queue (masked).',
  })
  listMerchantSubmissions(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(merchantKycOpsQueueQuerySchema))
    query: MerchantKycOpsQueueQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.listMerchantSubmissions(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        query,
      ),
    );
  }

  @Get('merchants/:branchId')
  @RequirePermission('merchant.kyc.view')
  @ApiOperation({
    summary: 'Merchant KYC submission detail — masked summary (audited).',
  })
  getMerchantKyc(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.getMerchantKyc(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        branchId,
      ),
    );
  }

  @Get('merchants/:branchId/evidence')
  @RequirePermission('merchant.kyc.evidence.view')
  @ApiOperation({
    summary:
      'Sensitive merchant KYC evidence (dedicated permission + reason + step-up; every view audited).',
  })
  getMerchantKycEvidence(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.getMerchantKycEvidence(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        branchId,
      ),
    );
  }

  @Post('merchants/:branchId/review')
  @RequirePermission('merchant.kyc.approve')
  @HttpCode(200)
  reviewMerchantKyc(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body(new ZodValidationPipe(merchantKycOpsReviewSchema))
    input: MerchantKycOpsReviewDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.reviewMerchantKyc(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        branchId,
        input,
        this.requireIdempotencyKey(idempotencyKey),
      ),
    );
  }

  /* ── Helpers ──────────────────────────────────────────────────────── */

  private currentMarket(request: Request): string {
    const context = (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext;
    if (!context?.marketId) {
      // The RbacGuard normally guarantees this; fail closed if absent.
      throw new ForbiddenException({
        code: 'MARKET_SELECTION_REQUIRED',
        message: 'Select an authorized market to continue.',
      });
    }
    return context.marketId;
  }

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): KycOpsActor {
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
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key || key.length > 200) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof KycOpsError) {
        throw new ConflictException({
          code: 'MARKET_CONTEXT_MISMATCH',
          message: error.message,
          details: error.details,
        });
      }
      if (!(error instanceof AdminKycError)) throw error;
      // Faithful re-map of the frozen Phase 2 owner error contract (the
      // owner controller applies the same mapping for its own routes).
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'ADMIN_KYC_CASE_NOT_FOUND':
          throw new NotFoundException(body);
        case 'ADMIN_KYC_SELF_REVIEW':
        case 'ADMIN_KYC_MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        case 'ADMIN_KYC_INVALID_STATE':
        case 'ADMIN_KYC_INVALID_TRANSITION':
        case 'ADMIN_KYC_IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
      }
    }
  }
}
