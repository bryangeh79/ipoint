import {
  ConflictException,
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
import { sql } from 'drizzle-orm';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthenticatedAdmin } from '../auth/authenticated-admin.decorator.js';
import { DatabaseService } from '../database/database.service.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
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

/**
 * P6-R2 (D-055): the refund admin routes now carry the canonical RbacGuard
 * chain (AuthGuard + AdminGuard + RbacGuard) with catalog permissions and
 * `marketScoped: true`:
 *
 * - `POST /` (Maker, OD-17): `redemption.refund.create` — SUPER_ADMIN /
 *   FINANCE_OPERATOR only (MAKER_ONLY template); the body market must equal
 *   the server Current Admin Market (RbacGuard consistency) and the owner
 *   additionally verifies the claimed member/market against the order.
 * - `POST /approve` and `POST /reject` (Checker): `redemption.refund.approve`
 *   — SUPER_ADMIN / FINANCE_APPROVER only (CHECKER_ONLY template), with the
 *   catalog `stepUpRequired` enforced by the RbacGuard (fresh MFA step-up
 *   token via `x-step-up-token`, GATE-SEC-02 action class).
 * - Reads: `redemption.order.read` (bounded projection; read-only support
 *   roles included, never the raw ledger), market-scoped to the server
 *   Current Admin Market.
 *
 * Resource-market consistency: the targeted refund request/order must belong
 * to the Current Admin Market (409 MARKET_CONTEXT_MISMATCH otherwise); list
 * projections are filtered to the current market in the owner read paths.
 */
@ApiTags('Admin Redemption Refund')
@Controller('admin/redemption/refunds')
@UseGuards(AuthGuard, AdminGuard, RbacGuard)
@ApiBearerAuth()
export class AdminRedemptionRefundController {
  constructor(
    @Inject(RedemptionRefundService)
    private readonly svc: RedemptionRefundService,
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
  ) {}

  private actor(adminId: string, request?: Request): ActorInfo {
    const requestId =
      typeof request?.headers?.['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : undefined;
    const ipAddress = typeof request?.ip === 'string' ? request.ip : undefined;
    return { actorType: 'ADMIN', actorId: adminId, requestId, ipAddress };
  }

  /** Server-owned Current Admin Market resolved by the RbacGuard. */
  private currentMarketId(request: Request): string | undefined {
    return (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext?.marketId;
  }

  /** Resource-market consistency: refund request must be in the market. */
  private async assertRefundMarket(
    refundRequestId: string,
    request: Request,
  ): Promise<void> {
    const currentMarketId = this.currentMarketId(request);
    if (!currentMarketId) throw this.marketMismatch();
    const rows = await this.database.db.execute(
      sql`SELECT o.market_id FROM redemption_refund_requests r
          JOIN redemption_orders o ON o.id = r.order_id
          WHERE r.id = ${refundRequestId}`,
    );
    const marketId = rows.rows[0]?.market_id as string | undefined;
    if (marketId && marketId !== currentMarketId) {
      throw this.marketMismatch();
    }
  }

  /** Resource-market consistency: order must be in the market. */
  private async assertOrderMarket(
    orderId: string,
    request: Request,
  ): Promise<void> {
    const currentMarketId = this.currentMarketId(request);
    if (!currentMarketId) throw this.marketMismatch();
    const rows = await this.database.db.execute(
      sql`SELECT market_id FROM redemption_orders WHERE id = ${orderId}`,
    );
    const marketId = rows.rows[0]?.market_id as string | undefined;
    if (marketId && marketId !== currentMarketId) {
      throw this.marketMismatch();
    }
  }

  private marketMismatch(): ConflictException {
    return new ConflictException({
      code: 'MARKET_CONTEXT_MISMATCH',
      message: 'The selected market changed. Refresh and try again.',
    });
  }

  // ─── Maker: Create Refund Request (OD-17) ─────────────────────────────

  @Post()
  @RequirePermission('redemption.refund.create', { marketScoped: true })
  @ApiOperation({
    summary: 'Create refund request (Maker) (OD-17)',
    description:
      'Full refund only (OD-12). Requires Checker approval. Idempotency-Key semantics: same key + same payload replays the stored request. The body market must equal the Current Admin Market.',
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
  @RequirePermission('redemption.refund.approve', { marketScoped: true })
  @ApiOperation({ summary: 'Approve refund request (Checker) (OD-17)' })
  async approveRefundRequest(
    @Body() dto: ApproveRefundDto,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<RefundRequestRecord> {
    await this.assertRefundMarket(dto.refundRequestId, request);
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
  @RequirePermission('redemption.refund.approve', { marketScoped: true })
  @ApiOperation({ summary: 'Reject refund request (Checker)' })
  async rejectRefundRequest(
    @Body() dto: RejectRefundDto,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<RefundRequestRecord> {
    await this.assertRefundMarket(dto.refundRequestId, request);
    return this.svc.rejectRefundRequest(
      dto.refundRequestId,
      adminId,
      dto.reason,
    );
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  @Get('pending')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({
    summary: 'List pending refund requests (current market only)',
  })
  async listPending(
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
    @Req() request: Request,
  ) {
    return this.svc.listPendingRefundRequests(
      Number(limit),
      Number(offset),
      this.currentMarketId(request),
    );
  }

  @Get()
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({ summary: 'List refund requests (current market only)' })
  async listAll(
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
    @Req() request: Request,
  ) {
    return this.svc.listAllRefundRequests(
      Number(limit),
      Number(offset),
      this.currentMarketId(request),
    );
  }

  @Get(':id')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({ summary: 'Get refund request by ID' })
  async getById(
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<RefundRequestRecord> {
    await this.assertRefundMarket(id, request);
    return this.svc.getRefundRequest(id);
  }

  @Get('order/:orderId')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({ summary: 'Get refund request by order ID' })
  async getByOrderId(
    @Param('orderId') orderId: string,
    @Req() request: Request,
  ): Promise<RefundRequestRecord> {
    await this.assertOrderMarket(orderId, request);
    return this.svc.getRefundRequestByOrderId(orderId);
  }
}
