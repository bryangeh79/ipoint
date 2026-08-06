import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import {
  createRechargeSchema,
  createAdjustmentSchema,
  adjustmentDecisionSchema,
  createRefundSchema,
  ledgerQuerySchema,
  reviewRechargeSchema,
  reviewRefundSchema,
  adjustmentQueueQuerySchema,
  type CreateAdjustmentDto,
  type AdjustmentDecisionDto,
  type CreateRefundDto,
  type CreateRechargeDto,
  type LedgerQueryDto,
  type ReviewRechargeDto,
  type ReviewRefundDto,
  type AdjustmentQueueQueryDto,
} from './dto/mcp.dto.js';
import { MerchantOwnershipGuard } from './guards/merchant-ownership.guard.js';
import { McpAdjustmentOwnerService } from './mcp-adjustment.owner.service.js';
import type { McpAdjustmentOwnerActor } from './mcp-adjustment.owner.types.js';
import { McpService } from './mcp.service.js';
import {
  requireAccountActor,
  requireAdminActor,
  type MerchantRequestContext,
} from './merchant.service.js';

@Controller()
export class McpController {
  constructor(
    @Inject(McpService) private readonly mcp: McpService,
    @Inject(McpAdjustmentOwnerService)
    private readonly adjustmentOwner: McpAdjustmentOwnerService,
  ) {}

  @Get('merchant/branches/:branchId/mcp')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  summary(@Param('branchId', new ParseUUIDPipe()) branchId: string) {
    return this.mcp.summary(branchId);
  }

  @Get('merchant/branches/:branchId/mcp/ledger')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  ledger(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQueryDto,
  ) {
    return this.mcp.ledger(branchId, query);
  }

  @Get('admin/markets/:marketId/mcp/accounts/:accountId')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.view', { marketScoped: true })
  adminAccount(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
  ) {
    return this.mcp.adminAccount(marketId, accountId);
  }

  @Get('admin/markets/:marketId/mcp/accounts/:accountId/ledger')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.view', { marketScoped: true })
  adminLedger(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQueryDto,
  ) {
    return this.mcp.adminLedger(marketId, accountId, query);
  }

  @Get('admin/markets/:marketId/mcp/accounts/:accountId/reconcile')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.view', { marketScoped: true })
  reconcile(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
  ) {
    return this.mcp.reconcile(marketId, accountId);
  }

  @Post('admin/markets/:marketId/merchants/:branchId/recharge')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.recharge.review', { marketScoped: true })
  createRecharge(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createRechargeSchema)) input: CreateRechargeDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.mcp.createRecharge(
      marketId,
      branchId,
      requireAdminActor(actor),
      input,
      requireKey(key),
      context(request, ip),
    );
  }

  @Post('admin/markets/:marketId/recharge/:requestId/review')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.recharge.review', { marketScoped: true })
  reviewRecharge(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(reviewRechargeSchema)) input: ReviewRechargeDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.mcp.reviewRecharge(
      marketId,
      requestId,
      requireAdminActor(actor),
      input,
      context(request, ip),
    );
  }

  @Post('admin/markets/:marketId/mcp/accounts/:accountId/adjustments')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.adjust', { marketScoped: true })
  createAdjustment(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createAdjustmentSchema))
    input: CreateAdjustmentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.adjustmentOwner.create(
      ownerActor(actor, marketId, request, ip),
      {
        mcpAccountId: accountId,
        entryType: input.type,
        amount: input.amount,
        reasonCode: input.reasonCode,
        explanation: input.explanation,
        caseReference: input.caseReference,
        attachmentReference: input.attachmentReference,
        priorRequestId: input.priorRequestId,
        idempotencyKey: requireKey(key),
      },
    );
  }

  @Post('admin/markets/:marketId/merchants/:branchId/adjustments')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.adjust', { marketScoped: true })
  async createBranchAdjustment(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createAdjustmentSchema))
    input: CreateAdjustmentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    const account = await this.mcp.adminAccountForBranch(marketId, branchId);
    return this.adjustmentOwner.create(
      ownerActor(actor, marketId, request, ip),
      {
        mcpAccountId: account.id,
        entryType: input.type,
        amount: input.amount,
        reasonCode: input.reasonCode,
        explanation: input.explanation,
        caseReference: input.caseReference,
        attachmentReference: input.attachmentReference,
        priorRequestId: input.priorRequestId,
        idempotencyKey: requireKey(key),
      },
    );
  }

  @Post('admin/markets/:marketId/mcp/adjustments/:requestId/submit')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.adjust', { marketScoped: true })
  submitAdjustment(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.adjustmentOwner.submit(
      ownerActor(actor, marketId, request, ip),
      {
        requestId,
      },
    );
  }

  @Post('admin/markets/:marketId/mcp/adjustments/:requestId/decision')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.adjust.approve', { marketScoped: true })
  decideAdjustment(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(adjustmentDecisionSchema))
    input: AdjustmentDecisionDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.adjustmentOwner.decide(
      ownerActor(actor, marketId, request, ip),
      requestId,
      {
        decision: input.decision,
        reason: input.reason,
        requireAttachment: input.requireAttachment,
      },
    );
  }

  @Post('admin/markets/:marketId/adjustments/:requestId/approve')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.adjust.approve', { marketScoped: true })
  approveAdjustment(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(adjustmentDecisionSchema))
    input: AdjustmentDecisionDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.adjustmentOwner.decide(
      ownerActor(actor, marketId, request, ip),
      requestId,
      {
        decision: 'APPROVED',
        reason: input.reason,
        requireAttachment: input.requireAttachment,
      },
    );
  }

  @Post('admin/markets/:marketId/adjustments/:requestId/execute')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.adjust.execute', { marketScoped: true })
  executeAdjustment(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.adjustmentOwner.execute(
      ownerActor(actor, marketId, request, ip),
      {
        requestId,
      },
    );
  }

  @Get('admin/markets/:marketId/mcp/adjustments')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.view', { marketScoped: true })
  adjustmentQueue(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(adjustmentQueueQuerySchema))
    query: AdjustmentQueueQueryDto,
  ) {
    return this.adjustmentOwner.listForMarket(marketId, {
      state: query.state,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('admin/markets/:marketId/mcp/adjustments/:requestId')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.mcp.view', { marketScoped: true })
  adjustmentDetail(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ) {
    return this.adjustmentOwner.detail(marketId, requestId);
  }

  @Post('merchant/branches/:branchId/mcp/refunds')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  createRefund(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createRefundSchema)) input: CreateRefundDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.mcp.createRefund(
      branchId,
      requireAccountActor(actor),
      input,
      requireKey(key),
      context(request, ip),
    );
  }

  @Post('admin/markets/:marketId/merchants/:branchId/refund')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.refund.manage', { marketScoped: true })
  createAdminRefund(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createRefundSchema)) input: CreateRefundDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.mcp.createAdminRefund(
      marketId,
      branchId,
      requireAdminActor(actor),
      input,
      requireKey(key),
      context(request, ip),
    );
  }

  @Post('admin/markets/:marketId/mcp/refunds/:requestId/review')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.refund.manage', { marketScoped: true })
  reviewRefund(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(reviewRefundSchema)) input: ReviewRefundDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.mcp.reviewRefund(
      marketId,
      requestId,
      requireAdminActor(actor),
      input,
      context(request, ip),
    );
  }

  @Post('admin/markets/:marketId/refund/:requestId/review')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.refund.manage', { marketScoped: true })
  reviewRefundAlias(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(reviewRefundSchema)) input: ReviewRefundDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.mcp.reviewRefund(
      marketId,
      requestId,
      requireAdminActor(actor),
      input,
      context(request, ip),
    );
  }
}

function requireKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200)
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  return key;
}
function context(request: Request, ipAddress: string): MerchantRequestContext {
  const requestId = (request as unknown as Record<string, unknown>)[
    'requestId'
  ];
  return {
    ipAddress,
    userAgent: request.headers['user-agent'],
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}
function ownerActor(
  actor: RequestActor | undefined,
  marketId: string,
  request: Request,
  ipAddress: string,
): McpAdjustmentOwnerActor {
  const adminUserId = requireAdminActor(actor);
  const marketContext = (
    request as Request & {
      adminMarketContext?: { marketId: string; contextVersion: number };
    }
  ).adminMarketContext;
  return {
    adminUserId,
    currentMarketId: marketContext?.marketId ?? marketId,
    marketContextVersion: marketContext?.contextVersion,
    ipAddress,
    ...(typeof (request as unknown as Record<string, unknown>)['requestId'] ===
    'string'
      ? {
          requestId: String(
            (request as unknown as Record<string, unknown>)['requestId'],
          ),
        }
      : {}),
  };
}
