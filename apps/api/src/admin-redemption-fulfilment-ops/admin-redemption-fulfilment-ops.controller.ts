import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
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
import {
  orderSuspendSchema,
  queueStatusSchema,
  redemptionQueueQuerySchema,
  refundQueueQuerySchema,
  type OrderSuspendDto,
  type RedemptionQueueQueryDto,
  type RefundQueueQueryDto,
} from './admin-redemption-fulfilment-ops.dto.js';
import { AdminRedemptionFulfilmentOpsService } from './admin-redemption-fulfilment-ops.service.js';
import {
  RedemptionFulfilmentOpsError,
  type FulfilmentQueueOverviewResponse,
  type FulfilmentQueueResponse,
  type OperationResultDto,
  type OrderAuditEntryDto,
  type OrderDetailResponse,
  type RedemptionFulfilmentOpsActor,
  type RefundDetailResponse,
  type RefundQueueResponse,
} from './admin-redemption-fulfilment-ops.types.js';

/**
 * P7-S8 Admin Redemption Operations adapter endpoints (Command Center
 * 2026-08-07 §6.2-§6.6).
 *
 * - `GET .../queues` — six-status fulfilment queue overview counts
 *   (`redemption.order.read`, marketScoped).
 * - `GET .../queues/:status` — one operational status queue
 *   (READY_FOR_PICKUP / BACKORDERED / FULFILMENT_SUSPENDED /
 *   FULFILMENT_EXCEPTION / REFUND_PENDING / REFUNDED), bounded projection
 *   with the linked fulfilment/refund/recovery records.
 * - `GET .../orders/:orderId` + `GET .../orders/:orderId/audit` — order
 *   detail and owner-owned immutable audit history.
 * - `POST .../orders/:orderId/suspend|resume` — `redemption.fulfilment.manage`
 *   (marketScoped): 1:1 delegation to the frozen Phase 6 owner commands
 *   (OD-28); the reason is mandatory for suspend.
 * - `POST .../fulfilments/:fulfilmentId/retry` —
 *   `redemption.fulfilment.manage`: admin failure-recovery delegation to the
 *   owner `retryFulfilment` command (OD-26).
 * - `GET .../refunds` + `GET .../refunds/:refundId` — SEC-02 owner read
 *   face: refund queue / detail / REFUND_* status history. No refund write
 *   exists on this surface (creation/approval stay on the frozen Phase 6
 *   routes).
 *
 * Market contract: canonical RbacGuard (all permissions marketScoped) — the
 * URL market must equal the server-owned Current Admin Market and the actor
 * must hold the market grant; client-supplied market disagreement returns
 * 409 `MARKET_CONTEXT_MISMATCH`. Resource-market consistency: every targeted
 * order/fulfilment/refund must belong to the Current Admin Market.
 */
@ApiTags('Admin Redemption Fulfilment Operations')
@ApiBearerAuth()
@Controller('admin/redemption-fulfilment-ops')
@UseGuards(AuthGuard, RbacGuard)
export class AdminRedemptionFulfilmentOpsController {
  constructor(
    @Inject(AdminRedemptionFulfilmentOpsService)
    private readonly ops: AdminRedemptionFulfilmentOpsService,
  ) {}

  @Get('markets/:marketId/queues')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Six-status fulfilment queue overview (current market).',
    description:
      'Selected-market counts of the six operational order statuses (READY_FOR_PICKUP / BACKORDERED / FULFILMENT_SUSPENDED / FULFILMENT_EXCEPTION / REFUND_PENDING / REFUNDED) plus the explicit rate-configuration capability state (rate_configured — canonical redemption_rate_market_rules source; an unconfigured market is reported, never silently treated as a fallback market).',
  })
  @ApiResponse({ status: 200, description: 'Queue overview.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  queueOverview(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<FulfilmentQueueOverviewResponse> {
    return this.handle(() =>
      this.ops.queueOverview(this.actor(actor, request, ip), marketId),
    );
  }

  @Get('markets/:marketId/queues/:status')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({
    summary: 'One fulfilment status queue (current market).',
    description:
      'Bounded read projection of the selected operational status queue with the linked fulfilment, refund request and shipping-payment recovery records, paginated (newest first). Only the six operational statuses are valid; anything else returns 422 REDEMPTION_QUEUE_STATUS_INVALID.',
  })
  @ApiResponse({ status: 200, description: 'Queue page.' })
  @ApiResponse({ status: 422, description: 'Invalid queue status.' })
  queue(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('status', new ZodValidationPipe(queueStatusSchema))
    status: string,
    @Query(new ZodValidationPipe(redemptionQueueQuerySchema))
    query: RedemptionQueueQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<FulfilmentQueueResponse> {
    return this.handle(() =>
      this.ops.queue(this.actor(actor, request, ip), marketId, status, query),
    );
  }

  @Get('markets/:marketId/orders/:orderId')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Order detail with fulfilment, refund, recovery and audit.',
    description:
      'Selected-market order detail: the order row, the linked fulfilment/refund/shipping-payment-recovery records and the owner-owned immutable audit trail. Read-only; no status transition is performed here.',
  })
  @ApiResponse({ status: 200, description: 'Order detail.' })
  @ApiResponse({ status: 404, description: 'Order or market not found.' })
  orderDetail(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<OrderDetailResponse> {
    return this.handle(() =>
      this.ops.orderDetail(this.actor(actor, request, ip), marketId, orderId),
    );
  }

  @Get('markets/:marketId/orders/:orderId/audit')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Order audit history (owner-owned immutable rows).',
    description:
      'The order audit trail: fulfilment audit events and redemption audit-log events for the order (newest first). Every suspend/resume/retry performed through this surface appends its owner audit row here.',
  })
  @ApiResponse({ status: 200, description: 'Audit history.' })
  orderAudit(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<OrderAuditEntryDto[]> {
    return this.handle(() =>
      this.ops.orderAudit(this.actor(actor, request, ip), marketId, orderId),
    );
  }

  @Post('markets/:marketId/orders/:orderId/suspend')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Suspend an order (reason required).',
    description:
      'Delegates 1:1 to the frozen Phase 6 owner command RedemptionFulfilmentService.suspendOrder (OD-28). The target order must belong to the Current Admin Market (409 MARKET_CONTEXT_MISMATCH otherwise); the reason is mandatory and stored durably by the owner, which also appends the immutable audit row. Invalid transitions return 409.',
  })
  @ApiResponse({ status: 200, description: 'Order suspended.' })
  @ApiResponse({ status: 400, description: 'Missing or invalid reason.' })
  @ApiResponse({
    status: 409,
    description: 'Invalid transition or market mismatch.',
  })
  suspendOrder(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body(new ZodValidationPipe(orderSuspendSchema)) input: OrderSuspendDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<OperationResultDto> {
    return this.handle(() =>
      this.ops.suspendOrder(
        this.actor(actor, request, ip),
        marketId,
        orderId,
        input.reason,
      ),
    );
  }

  @Post('markets/:marketId/orders/:orderId/resume')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resume a suspended order.',
    description:
      'Delegates 1:1 to the frozen Phase 6 owner command RedemptionFulfilmentService.resumeOrder (OD-28); the owner resolves the target status and appends the immutable audit row. Orders that are not FULFILMENT_SUSPENDED are rejected with 409 REDEMPTION_ORDER_NOT_SUSPENDED.',
  })
  @ApiResponse({ status: 200, description: 'Order resumed.' })
  @ApiResponse({
    status: 409,
    description: 'Order not suspended or market mismatch.',
  })
  resumeOrder(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<OperationResultDto> {
    return this.handle(() =>
      this.ops.resumeOrder(this.actor(actor, request, ip), marketId, orderId),
    );
  }

  @Post('markets/:marketId/fulfilments/:fulfilmentId/retry')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retry a FAILED fulfilment (admin failure recovery).',
    description:
      'Delegates 1:1 to the frozen Phase 6 owner command RedemptionFulfilmentService.retryFulfilment (OD-26). The fulfilment must belong to the Current Admin Market and be FAILED; the owner resets it to PENDING and appends the immutable FULFILMENT_RETRY audit row.',
  })
  @ApiResponse({ status: 200, description: 'Fulfilment queued for retry.' })
  @ApiResponse({ status: 409, description: 'Not FAILED or market mismatch.' })
  retryFulfilment(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('fulfilmentId', new ParseUUIDPipe()) fulfilmentId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<OperationResultDto> {
    return this.handle(() =>
      this.ops.retryFulfilment(
        this.actor(actor, request, ip),
        marketId,
        fulfilmentId,
      ),
    );
  }

  @Get('markets/:marketId/refunds')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Refund queue (SEC-02 owner read face).',
    description:
      'Selected-market refund request queue (status-filterable, paginated, newest first) over the frozen SEC-02 owner rows. Read-only: refund creation/approval stay exclusively on the frozen Phase 6 routes; this surface exposes no refund write.',
  })
  @ApiResponse({ status: 200, description: 'Refund queue.' })
  refundQueue(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(refundQueueQuerySchema))
    query: RefundQueueQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<RefundQueueResponse> {
    return this.handle(() =>
      this.ops.refundQueue(this.actor(actor, request, ip), marketId, query),
    );
  }

  @Get('markets/:marketId/refunds/:refundId')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Refund detail with REFUND_* status history.',
    description:
      'Selected-market refund request detail plus the owner-owned immutable REFUND_* audit events for the order (REFUND_REQUESTED / REFUND_APPROVED / REFUND_EXECUTED / REFUND_REJECTED / REFUND_EXECUTION_FAILED), newest first.',
  })
  @ApiResponse({ status: 200, description: 'Refund detail.' })
  @ApiResponse({
    status: 404,
    description: 'Refund request or market not found.',
  })
  refundDetail(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('refundId', new ParseUUIDPipe()) refundId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<RefundDetailResponse> {
    return this.handle(() =>
      this.ops.refundDetail(this.actor(actor, request, ip), marketId, refundId),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): RedemptionFulfilmentOpsActor {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      });
    }
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
    const marketContext = (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext;
    return {
      adminUserId: actor.adminUserId,
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
      ...(marketContext ? { currentMarketId: marketContext.marketId } : {}),
    };
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RedemptionFulfilmentOpsError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'REDEMPTION_MARKET_NOT_FOUND':
        case 'REDEMPTION_ORDER_NOT_FOUND':
        case 'REDEMPTION_FULFILMENT_NOT_FOUND':
        case 'REDEMPTION_REFUND_NOT_FOUND':
          throw new NotFoundException(body);
        case 'PERMISSION_DENIED':
        case 'MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        case 'MARKET_SELECTION_REQUIRED':
        case 'MARKET_CONTEXT_MISMATCH':
        case 'REDEMPTION_ORDER_NOT_SUSPENDED':
        case 'REDEMPTION_ORDER_CANNOT_SUSPEND':
        case 'REDEMPTION_FULFILMENT_INVALID_TRANSITION':
        case 'REDEMPTION_FULFILMENT_NOT_FAILED':
        case 'REDEMPTION_FULFILMENT_MAX_RETRIES':
        case 'REDEMPTION_FULFILMENT_NON_RETRYABLE':
          throw new ConflictException(body);
        case 'REDEMPTION_REASON_REQUIRED':
          throw new BadRequestException(body);
        case 'REDEMPTION_QUEUE_STATUS_INVALID':
          throw new UnprocessableEntityException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}
