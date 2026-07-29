import {
  Controller,
  Post,
  Put,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthenticatedAdmin } from '../auth/authenticated-admin.decorator.js';
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

@ApiTags('Admin Redemption Fulfilment')
@Controller('admin/redemption/fulfilments')
@UseGuards(AuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminRedemptionFulfilmentController {
  constructor(
    @Inject(RedemptionFulfilmentService)
    private readonly svc: RedemptionFulfilmentService,
  ) {}

  private actor(adminId: string): ActorInfo {
    return { actorType: 'ADMIN', actorId: adminId };
  }

  @Post()
  @ApiOperation({ summary: 'Create fulfilment record for an order' })
  async create(
    @Body() dto: CreateFulfilmentDto,
    @AuthenticatedAdmin() adminId: string,
  ): Promise<FulfilmentRecord> {
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
      this.actor(adminId),
    );
  }

  @Put('status')
  @ApiOperation({ summary: 'Update fulfilment status' })
  async updateStatus(
    @Body() dto: UpdateFulfilmentStatusDto,
    @AuthenticatedAdmin() adminId: string,
  ): Promise<FulfilmentRecord> {
    return this.svc.updateStatus(
      {
        fulfilmentId: dto.fulfilmentId,
        status: dto.status,
        trackingNumber: dto.trackingNumber,
        courier: dto.courier,
        failureReason: dto.failureReason,
      },
      this.actor(adminId),
    );
  }

  @Post(':fulfilmentId/pickup-code')
  @ApiOperation({ summary: 'Generate single-use pickup code' })
  async generatePickupCode(
    @Param('fulfilmentId') fulfilmentId: string,
  ): Promise<{ pickupCode: string }> {
    const code = await this.svc.generatePickupCode(fulfilmentId);
    return { pickupCode: code };
  }

  @Post(':fulfilmentId/verify-pickup')
  @ApiOperation({ summary: 'Verify pickup code and complete' })
  async verifyPickup(
    @Param('fulfilmentId') fulfilmentId: string,
    @Body() dto: { code: string },
    @AuthenticatedAdmin() adminId: string,
  ): Promise<{ verified: boolean }> {
    const result = await this.svc.verifyPickup(
      fulfilmentId,
      dto.code,
      this.actor(adminId),
    );
    return { verified: result.verified };
  }

  @Post(':fulfilmentId/retry')
  @ApiOperation({ summary: 'Retry a failed fulfilment (OD-26)' })
  async retry(
    @Param('fulfilmentId') fulfilmentId: string,
    @AuthenticatedAdmin() adminId: string,
  ): Promise<FulfilmentRecord> {
    return this.svc.retryFulfilment(fulfilmentId, this.actor(adminId));
  }

  @Post(':orderId/suspend')
  @ApiOperation({ summary: 'Suspend order fulfilment (OD-28)' })
  async suspend(
    @Param('orderId') orderId: string,
    @Body() dto: { reason?: string },
    @AuthenticatedAdmin() adminId: string,
  ): Promise<void> {
    await this.svc.suspendOrder(
      orderId,
      dto.reason ?? 'Admin suspension',
      this.actor(adminId),
    );
  }

  @Post(':orderId/resume')
  @ApiOperation({ summary: 'Resume suspended order (OD-28)' })
  async resume(
    @Param('orderId') orderId: string,
    @AuthenticatedAdmin() adminId: string,
  ): Promise<{ status: string }> {
    const s = await this.svc.resumeOrder(orderId, this.actor(adminId));
    return { status: s };
  }

  @Post(':orderId/backorder')
  @ApiOperation({ summary: 'Move order to BACKORDERED (OD-27)' })
  async backorder(
    @Param('orderId') orderId: string,
    @Body() dto: { estimatedRestockAt?: string },
    @AuthenticatedAdmin() adminId: string,
  ): Promise<void> {
    await this.svc.moveToBackorder(
      orderId,
      dto.estimatedRestockAt ?? null,
      this.actor(adminId),
    );
  }

  @Post(':orderId/restock')
  @ApiOperation({ summary: 'Process restock for backordered order (OD-27)' })
  async restock(
    @Param('orderId') orderId: string,
    @AuthenticatedAdmin() adminId: string,
  ): Promise<void> {
    await this.svc.processRestock(orderId, this.actor(adminId));
  }

  @Post('waitlist')
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
  ): Promise<{ subscriptionId: string }> {
    void _adminId;
    const sub = await this.svc.subscribeWaitlist(
      dto.memberId,
      dto.marketId,
      dto.itemId,
      dto.requestedQuantity ?? '1',
    );
    return { subscriptionId: sub.id };
  }

  @Delete('waitlist/:subscriptionId')
  @ApiOperation({ summary: 'Cancel waitlist subscription' })
  async cancelWaitlist(
    @Param('subscriptionId') id: string,
    @AuthenticatedAdmin() adminId: string,
  ): Promise<void> {
    await this.svc.cancelWaitlist(id, this.actor(adminId));
  }

  @Post(':itemId/notify-waitlist')
  @ApiOperation({ summary: 'Notify all active waitlist subscribers (OD-27)' })
  async notifyWaitlist(
    @Param('itemId') itemId: string,
  ): Promise<{ notified: number }> {
    const count = await this.svc.notifyWaitlist(itemId);
    return { notified: count };
  }

  @Post('waitlist/:subscriptionId/expire')
  @ApiOperation({ summary: 'Expire a waitlist subscription' })
  async expireWaitlist(@Param('subscriptionId') id: string): Promise<void> {
    await this.svc.expireWaitlist(id);
  }

  @Get('pending')
  @ApiOperation({ summary: 'List pending fulfilments' })
  async listPending(
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    return this.svc.listPending(Number(limit), Number(offset));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fulfilment by ID' })
  async getById(@Param('id') id: string): Promise<FulfilmentRecord> {
    return this.svc.getById(id);
  }
}
