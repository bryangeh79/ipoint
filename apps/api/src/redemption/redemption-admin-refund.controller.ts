import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthenticatedAdmin } from '../auth/authenticated-admin.decorator.js';
import { RedemptionRefundService } from './redemption-refund.service.js';
import type { RefundRequestRecord, ActorInfo } from './redemption.types.js';

// ─── DTOs ───────────────────────────────────────────────────────────────

interface CreateRefundDto {
  orderId: string;
  memberId: string;
  marketId: string;
  totalPointCost: string;
  reason: string;
  makerNotes?: string;
  /**
   * SEC-02: required operation-level idempotency key. The owner enforces it;
   * same key + same payload replays, same key + different payload is
   * rejected with a conflict.
   */
  idempotencyKey: string;
}

interface ApproveRefundDto {
  refundRequestId: string;
  checkerNotes?: string;
}

interface RejectRefundDto {
  refundRequestId: string;
  reason: string;
}

// ─── Controller ─────────────────────────────────────────────────────────

@ApiTags('Admin Redemption Refund')
@Controller('admin/redemption/refunds')
@UseGuards(AuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminRedemptionRefundController {
  constructor(
    @Inject(RedemptionRefundService)
    private readonly svc: RedemptionRefundService,
  ) {}

  private actor(adminId: string, request?: Request): ActorInfo {
    const requestId =
      typeof request?.headers?.['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : undefined;
    const ipAddress =
      typeof request?.ip === 'string' ? request.ip : undefined;
    return { actorType: 'ADMIN', actorId: adminId, requestId, ipAddress };
  }

  // ─── Maker: Create Refund Request (OD-17) ─────────────────────────────

  @Post()
  @ApiOperation({
    summary: 'Create refund request (Maker) (OD-17)',
    description:
      'Full refund only (OD-12). Requires Checker approval. Idempotency-Key semantics: same key + same payload replays the stored request.',
  })
  async createRefundRequest(
    @Body() dto: CreateRefundDto,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<RefundRequestRecord> {
    return this.svc.createRefundRequest(
      {
        orderId: dto.orderId,
        memberId: dto.memberId,
        marketId: dto.marketId,
        totalPointCost: dto.totalPointCost,
        reason: dto.reason,
        makerId: adminId,
        makerNotes: dto.makerNotes,
        idempotencyKey: dto.idempotencyKey,
      },
      this.actor(adminId, request),
    );
  }

  // ─── Checker: Approve Refund Request (OD-17) ──────────────────────────

  @Post('approve')
  @ApiOperation({ summary: 'Approve refund request (Checker) (OD-17)' })
  async approveRefundRequest(
    @Body() dto: ApproveRefundDto,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<RefundRequestRecord> {
    return this.svc.approveRefundRequest(
      {
        refundRequestId: dto.refundRequestId,
        checkerId: adminId,
        checkerNotes: dto.checkerNotes,
      },
      this.actor(adminId, request),
    );
  }

  // ─── Checker: Reject Refund Request ───────────────────────────────────

  @Post('reject')
  @ApiOperation({ summary: 'Reject refund request' })
  async rejectRefundRequest(
    @Body() dto: RejectRefundDto,
    @AuthenticatedAdmin() adminId: string,
  ): Promise<RefundRequestRecord> {
    return this.svc.rejectRefundRequest(
      dto.refundRequestId,
      adminId,
      dto.reason,
    );
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  @Get('pending')
  @ApiOperation({ summary: 'List pending refund requests' })
  async listPending(
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    return this.svc.listPendingRefundRequests(Number(limit), Number(offset));
  }

  @Get()
  @ApiOperation({ summary: 'List all refund requests' })
  async listAll(@Query('limit') limit = '50', @Query('offset') offset = '0') {
    return this.svc.listAllRefundRequests(Number(limit), Number(offset));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get refund request by ID' })
  async getById(@Param('id') id: string): Promise<RefundRequestRecord> {
    return this.svc.getRefundRequest(id);
  }

  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get refund request by order ID' })
  async getByOrderId(
    @Param('orderId') orderId: string,
  ): Promise<RefundRequestRecord> {
    return this.svc.getRefundRequestByOrderId(orderId);
  }
}
