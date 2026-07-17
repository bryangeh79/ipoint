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
  type CreateAdjustmentDto,
  type AdjustmentDecisionDto,
  type CreateRefundDto,
  type CreateRechargeDto,
  type LedgerQueryDto,
  type ReviewRechargeDto,
  type ReviewRefundDto,
} from './dto/mcp.dto.js';
import { MerchantOwnershipGuard } from './guards/merchant-ownership.guard.js';
import { McpService } from './mcp.service.js';
import {
  requireAccountActor,
  requireAdminActor,
  type MerchantRequestContext,
} from './merchant.service.js';

@Controller()
export class McpController {
  constructor(@Inject(McpService) private readonly mcp: McpService) {}

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
    return this.mcp.createAdjustment(
      marketId,
      accountId,
      requireAdminActor(actor),
      input,
      requireKey(key),
      context(request, ip),
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
    return this.mcp.submitAdjustment(
      marketId,
      requestId,
      requireAdminActor(actor),
      context(request, ip),
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
    return this.mcp.decideAdjustment(
      marketId,
      requestId,
      requireAdminActor(actor),
      input,
      context(request, ip),
    );
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
