import {
  ConflictException,
  Controller,
  Post,
  Put,
  Get,
  Delete,
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
import { RedemptionFulfilmentService } from './redemption-fulfilment.service.js';
import type { FulfilmentRecord, ActorInfo } from './redemption.types.js';

// ─── DTOs ───────────────────────────────────────────────────────────────

interface CreateFulfilmentDto {
  orderId: string;
  fulfilmentType: 'PHYSICAL' | 'DIGITAL' | 'SERVICE';
  pickupLocationId?: string;
  shippingAddress?: Record<string, unknown>;
  trackingNumber?: string;
  courier?: string;
  estimatedDeliveryDate?: string;
  serviceScheduledAt?: string;
  serviceNotes?: string;
}

interface UpdateFulfilmentStatusDto {
  fulfilmentId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  trackingNumber?: string;
  courier?: string;
  failureReason?: string;
}

// ─── Controller ─────────────────────────────────────────────────────────

/**
 * P6-R2 (D-055): all fulfilment admin routes now carry the canonical
 * RbacGuard chain (AuthGuard + AdminGuard + RbacGuard) with the catalog
 * permission, `marketScoped: true`, and resource-market consistency: the
 * target order/fulfilment/waitlist/catalog item must belong to the
 * server-owned Current Admin Market (409 MARKET_CONTEXT_MISMATCH
 * otherwise). Writes require `redemption.fulfilment.manage` (SUPER_ADMIN /
 * OPERATIONS_ADMIN only); reads require `redemption.order.read` (bounded
 * projection, read-only roles included — never the raw ledger).
 */
@ApiTags('Admin Redemption Fulfilment')
@Controller('admin/redemption/fulfilments')
@UseGuards(AuthGuard, AdminGuard, RbacGuard)
@ApiBearerAuth()
export class AdminRedemptionFulfilmentController {
  constructor(
    @Inject(RedemptionFulfilmentService)
    private readonly svc: RedemptionFulfilmentService,
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

  /** Resource-market consistency: order must belong to the current market. */
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

  /** Resource-market consistency: fulfilment's order must be in the market. */
  private async assertFulfilmentMarket(
    fulfilmentId: string,
    request: Request,
  ): Promise<void> {
    const currentMarketId = this.currentMarketId(request);
    if (!currentMarketId) throw this.marketMismatch();
    const rows = await this.database.db.execute(
      sql`SELECT o.market_id FROM redemption_fulfilments f
          JOIN redemption_orders o ON o.id = f.order_id
          WHERE f.id = ${fulfilmentId}`,
    );
    const marketId = rows.rows[0]?.market_id as string | undefined;
    if (marketId && marketId !== currentMarketId) {
      throw this.marketMismatch();
    }
  }

  /** Resource-market consistency: waitlist subscription market. */
  private async assertWaitlistMarket(
    subscriptionId: string,
    request: Request,
  ): Promise<void> {
    const currentMarketId = this.currentMarketId(request);
    if (!currentMarketId) throw this.marketMismatch();
    const rows = await this.database.db.execute(
      sql`SELECT market_id FROM redemption_waitlist_entries WHERE id = ${subscriptionId}`,
    );
    const marketId = rows.rows[0]?.market_id as string | undefined;
    if (marketId && marketId !== currentMarketId) {
      throw this.marketMismatch();
    }
  }

  /** Resource-market consistency: catalog item market. */
  private async assertItemMarket(
    itemId: string,
    request: Request,
  ): Promise<void> {
    const currentMarketId = this.currentMarketId(request);
    if (!currentMarketId) throw this.marketMismatch();
    const rows = await this.database.db.execute(
      sql`SELECT market_id FROM redemption_catalog_items WHERE id = ${itemId}`,
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

  @Post()
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Create fulfilment record for an order' })
  async create(
    @Body() dto: CreateFulfilmentDto,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<FulfilmentRecord> {
    await this.assertOrderMarket(dto.orderId, request);
    return this.svc.createFulfilment(
      {
        orderId: dto.orderId,
        fulfilmentType: dto.fulfilmentType,
        pickupLocationId: dto.pickupLocationId,
        shippingAddress: dto.shippingAddress,
        trackingNumber: dto.trackingNumber,
        courier: dto.courier,
        estimatedDeliveryDate: dto.estimatedDeliveryDate,
        serviceScheduledAt: dto.serviceScheduledAt,
        serviceNotes: dto.serviceNotes,
      },
      this.actor(adminId, request),
    );
  }

  @Put('status')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Update fulfilment status' })
  async updateStatus(
    @Body() dto: UpdateFulfilmentStatusDto,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<FulfilmentRecord> {
    await this.assertFulfilmentMarket(dto.fulfilmentId, request);
    return this.svc.updateStatus(
      {
        fulfilmentId: dto.fulfilmentId,
        status: dto.status,
        trackingNumber: dto.trackingNumber,
        courier: dto.courier,
        failureReason: dto.failureReason,
      },
      this.actor(adminId, request),
    );
  }

  @Post(':fulfilmentId/pickup-code')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Generate single-use pickup code' })
  async generatePickupCode(
    @Param('fulfilmentId') fulfilmentId: string,
    @Req() request: Request,
  ): Promise<{ pickupCode: string }> {
    await this.assertFulfilmentMarket(fulfilmentId, request);
    const code = await this.svc.generatePickupCode(fulfilmentId);
    return { pickupCode: code };
  }

  @Post(':fulfilmentId/verify-pickup')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Verify pickup code and complete' })
  async verifyPickup(
    @Param('fulfilmentId') fulfilmentId: string,
    @Body() dto: { code: string },
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<{ verified: boolean }> {
    await this.assertFulfilmentMarket(fulfilmentId, request);
    const result = await this.svc.verifyPickup(
      fulfilmentId,
      dto.code,
      this.actor(adminId, request),
    );
    return { verified: result.verified };
  }

  @Post(':fulfilmentId/retry')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Retry a failed fulfilment (OD-26)' })
  async retry(
    @Param('fulfilmentId') fulfilmentId: string,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<FulfilmentRecord> {
    await this.assertFulfilmentMarket(fulfilmentId, request);
    return this.svc.retryFulfilment(fulfilmentId, this.actor(adminId, request));
  }

  @Post(':orderId/suspend')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Suspend order fulfilment (OD-28)' })
  async suspend(
    @Param('orderId') orderId: string,
    @Body() dto: { reason?: string },
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.assertOrderMarket(orderId, request);
    await this.svc.suspendOrder(
      orderId,
      dto.reason ?? 'Admin suspension',
      this.actor(adminId, request),
    );
  }

  @Post(':orderId/resume')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Resume suspended order (OD-28)' })
  async resume(
    @Param('orderId') orderId: string,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<{ status: string }> {
    await this.assertOrderMarket(orderId, request);
    const s = await this.svc.resumeOrder(orderId, this.actor(adminId, request));
    return { status: s };
  }

  @Post(':orderId/backorder')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Move order to BACKORDERED (OD-27)' })
  async backorder(
    @Param('orderId') orderId: string,
    @Body() dto: { estimatedRestockAt?: string },
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.assertOrderMarket(orderId, request);
    await this.svc.moveToBackorder(
      orderId,
      dto.estimatedRestockAt ?? null,
      this.actor(adminId, request),
    );
  }

  @Post(':orderId/restock')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Process restock for backordered order (OD-27)' })
  async restock(
    @Param('orderId') orderId: string,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.assertOrderMarket(orderId, request);
    await this.svc.processRestock(orderId, this.actor(adminId, request));
  }

  @Post('waitlist')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Subscribe member to waitlist (OD-27)' })
  async subscribeWaitlist(
    @Body()
    dto: {
      memberId: string;
      marketId: string;
      itemId: string;
      requestedQuantity?: string;
    },
    @AuthenticatedAdmin() _adminId: string,
    @Req() request: Request,
  ): Promise<{ subscriptionId: string }> {
    void _adminId;
    void request;
    const sub = await this.svc.subscribeWaitlist(
      dto.memberId,
      dto.marketId,
      dto.itemId,
      dto.requestedQuantity ?? '1',
    );
    return { subscriptionId: sub.id };
  }

  @Delete('waitlist/:subscriptionId')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Cancel waitlist subscription' })
  async cancelWaitlist(
    @Param('subscriptionId') id: string,
    @AuthenticatedAdmin() adminId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.assertWaitlistMarket(id, request);
    await this.svc.cancelWaitlist(id, this.actor(adminId, request));
  }

  @Post(':itemId/notify-waitlist')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Notify all active waitlist subscribers (OD-27)' })
  async notifyWaitlist(
    @Param('itemId') itemId: string,
    @Req() request: Request,
  ): Promise<{ notified: number }> {
    await this.assertItemMarket(itemId, request);
    const count = await this.svc.notifyWaitlist(itemId);
    return { notified: count };
  }

  @Post('waitlist/:subscriptionId/expire')
  @RequirePermission('redemption.fulfilment.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Expire a waitlist subscription' })
  async expireWaitlist(
    @Param('subscriptionId') id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.assertWaitlistMarket(id, request);
    await this.svc.expireWaitlist(id);
  }

  @Get('pending')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({ summary: 'List pending fulfilments (current market only)' })
  async listPending(
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
    @Req() request: Request,
  ) {
    return this.svc.listPending(
      Number(limit),
      Number(offset),
      this.currentMarketId(request),
    );
  }

  @Get(':id')
  @RequirePermission('redemption.order.read', { marketScoped: true })
  @ApiOperation({ summary: 'Get fulfilment by ID' })
  async getById(
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<FulfilmentRecord> {
    await this.assertFulfilmentMarket(id, request);
    return this.svc.getById(id);
  }
}
