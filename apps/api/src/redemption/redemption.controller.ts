import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { RedemptionService } from './redemption.service.js';
import { RedemptionError } from './redemption.errors.js';
import {
  type MemberCatalogQueryDto,
  type QuoteQueryDto,
  memberCatalogQuerySchema,
  quoteQuerySchema,
} from './redemption.dto.js';

/**
 * The table names used for member market preference resolution.
 * These are defined in the Phase 2/3 schema (migrations 0007-0014).
 */
const MEMBER_TABLE = 'members';
const MARKET_PREF_TABLE = 'member_market_preferences';

@ApiTags('Redemption')
@Controller('redemption')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class RedemptionController {
  constructor(
    @Inject(RedemptionService) private readonly redemption: RedemptionService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // CATALOG BROWSE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Browse the redemption catalog for the member's current market.
   * Market is resolved from the member's current market preference.
   */
  @Get('catalog')
  async browseCatalog(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(memberCatalogQuerySchema))
    query: MemberCatalogQueryDto,
  ) {
    const marketId = await this.resolveCurrentMarket(actor.accountId);
    return this.handle(() => this.redemption.browseCatalog(marketId, query));
  }

  /**
   * Get detail for a specific catalog item.
   */
  @Get('catalog/:itemId')
  async getItemDetail(
    @CurrentActor() actor: RequestActor,
    @Param('itemId') itemId: string,
  ) {
    const marketId = await this.resolveCurrentMarket(actor.accountId);
    return this.handle(() => this.redemption.getItemDetail(marketId, itemId));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // QUOTE GENERATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generate a quote for a specific catalog item.
   *
   * Rate Conversion Pricing (OD-21):
   * required_iPoint = fiat_reference_value / redemption_rate
   *
   * Rate Locked at Quote Time (OD-22):
   * Rate version captured at generation time.
   * Client must NOT submit price/rate.
   */
  @Get('catalog/:itemId/quote')
  async generateQuote(
    @CurrentActor() actor: RequestActor,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(quoteQuerySchema))
    query: QuoteQueryDto,
  ) {
    const marketId = await this.resolveCurrentMarket(actor.accountId);
    return this.handle(() =>
      this.redemption.generateQuote(
        actor.accountId,
        marketId,
        itemId,
        query.quantity,
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SHIPPING COST
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Calculate shipping cost for an item.
   */
  @Get('catalog/:itemId/shipping-cost')
  async calculateShippingCost(
    @CurrentActor() actor: RequestActor,
    @Param('itemId') itemId: string,
    @Query('fulfilmentMode') fulfilmentMode: string,
  ) {
    const marketId = await this.resolveCurrentMarket(actor.accountId);
    if (
      !fulfilmentMode ||
      !['DELIVERY', 'PICKUP', 'DELIVERY_OR_PICKUP'].includes(fulfilmentMode)
    ) {
      throw new BadRequestException({
        code: 'REDEMPTION_INVALID_FULFILMENT_MODE',
        message: 'Valid fulfilmentMode query parameter is required.',
      });
    }
    return this.handle(() =>
      this.redemption.calculateShippingCost(marketId, itemId, fulfilmentMode),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SHIPPING PAYMENT
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create a shipping payment intent.
   * Returns provider-specific details for the frontend to complete payment.
   */
  @Post('shipping-payment')
  @HttpCode(201)
  async createShippingPayment(
    @CurrentActor() actor: RequestActor,
    @Body()
    body: {
      quoteId: string;
      fulfilmentMode: string;
      pickupLocationId?: string;
      shippingAddress?: Record<string, unknown>;
      idempotencyKey: string;
    },
  ) {
    const marketId = await this.resolveCurrentMarket(actor.accountId);
    return this.handle(() =>
      this.redemption.createShippingPayment(actor.accountId, marketId, body),
    );
  }

  /**
   * Confirm a shipping payment after the frontend completes payment.
   */
  @Post('shipping-payment/:paymentId/confirm')
  @HttpCode(200)
  confirmShippingPayment(
    @CurrentActor() _actor: RequestActor,
    @Param('paymentId') paymentId: string,
    @Body() body: { providerIntentId: string },
  ) {
    return this.handle(() =>
      this.redemption.confirmShippingPayment(paymentId, body.providerIntentId),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ORDER CONFIRMATION (P6-S4)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * POST /redemption/orders
   *
   * Atomically confirm a redemption order with Direct Atomic Debit.
   *
   * Client submits only:
   *   - quoteId, idempotencyKey
   *   - expectedItemVersion, expectedTotalPoints
   *   - fulfilment selection (delivery address or pickup location)
   *   - terms acceptance confirmation
   *   - shipping payment intent reference (for delivery)
   *
   * Client must NOT submit rate, fiat value, point cost, wallet market,
   * shipping fee amount, refund amount, or commission data.
   */
  @Post('orders')
  @HttpCode(201)
  async confirmOrder(
    @CurrentActor() actor: RequestActor,
    @Body()
    body: {
      quoteId: string;
      idempotencyKey: string;
      expectedItemVersion: number;
      expectedTotalPoints: string;
      expectedQuantity: string;
      fulfilment: {
        type: 'DELIVERY' | 'PICKUP';
        deliveryAddress?: {
          name: string;
          phone: string;
          line1: string;
          line2?: string;
          city: string;
          state?: string;
          postcode: string;
          country: string;
        };
        pickupLocationId?: string;
      };
      termsAcceptance: {
        accepted: boolean;
        termsVersion: string;
      };
      shippingPaymentIntentReference?: string;
    },
  ) {
    const marketId = await this.resolveCurrentMarket(actor.accountId);
    const memberRow = await this.database.db.execute(
      sql`SELECT id FROM members WHERE account_id = ${actor.accountId}`,
    );
    if (!memberRow.rows[0]) {
      throw new BadRequestException({
        code: 'REDEMPTION_MEMBER_NOT_FOUND',
        message: 'Member profile not found.',
      });
    }
    const memberId = memberRow.rows[0].id as string;

    return this.handle(() =>
      this.redemption.confirmOrder(
        memberId,
        marketId,
        {
          quoteId: body.quoteId,
          idempotencyKey: body.idempotencyKey,
          expectedItemVersion: body.expectedItemVersion,
          expectedTotalPoints: body.expectedTotalPoints,
          expectedQuantity: body.expectedQuantity,
          fulfilment: body.fulfilment,
          termsAcceptance: body.termsAcceptance,
          shippingPaymentIntentReference: body.shippingPaymentIntentReference,
        },
        {
          ipAddress: '',
          requestId: '',
        },
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RedemptionError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'REDEMPTION_CATALOG_ITEM_NOT_FOUND':
        case 'REDEMPTION_RATE_NOT_FOUND':
        case 'REDEMPTION_QUOTE_NOT_FOUND':
        case 'REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND':
        case 'REDEMPTION_WALLET_NOT_FOUND':
        case 'REDEMPTION_MEMBER_NOT_FOUND':
        case 'REDEMPTION_RATE_EXPIRED':
          throw new NotFoundException(body);
        case 'REDEMPTION_QUOTE_EXPIRED':
        case 'REDEMPTION_QUOTE_STALE':
        case 'REDEMPTION_QUOTE_TAMPERED':
        case 'REDEMPTION_QUOTE_POINT_MISMATCH':
        case 'REDEMPTION_INVENTORY_INSUFFICIENT':
        case 'REDEMPTION_BALANCE_INSUFFICIENT':
        case 'REDEMPTION_MEMBER_SUSPENDED':
        case 'REDEMPTION_KYC_REQUIRED':
        case 'REDEMPTION_WALLET_VERSION_CONFLICT':
        case 'REDEMPTION_TERMS_NOT_ACCEPTED':
        case 'REDEMPTION_SHIPPING_PAYMENT_FAILED':
        case 'REDEMPTION_SHIPPING_ADAPTER_ERROR':
          throw new ConflictException(body);
        default:
          throw new BadRequestException(body);
      }
    }
  }

  /**
   * Resolve the member's current market from their market preferences.
   * OD-04 ensures CURRENT_MARKET determines catalog, rates, wallet, etc.
   */
  private async resolveCurrentMarket(accountId: string): Promise<string> {
    const db = this.database.db;

    // Get member ID from account ID
    const memberResult = await db.execute(
      sql`SELECT id FROM ${sql.identifier(MEMBER_TABLE)}
          WHERE account_id = ${accountId}`,
    );
    const memberRow = memberResult.rows[0];
    if (!memberRow) {
      throw new BadRequestException({
        code: 'REDEMPTION_MEMBER_NOT_FOUND',
        message: 'Member profile not found.',
      });
    }

    // Get current market preference
    const prefResult = await db.execute(
      sql`SELECT market_id FROM ${sql.identifier(MARKET_PREF_TABLE)}
          WHERE member_id = ${memberRow.id} AND is_current = true
          LIMIT 1`,
    );
    const prefRow = prefResult.rows[0];
    if (!prefRow) {
      throw new BadRequestException({
        code: 'REDEMPTION_MARKET_REQUIRED',
        message: 'No current market configured. Please select a market.',
      });
    }

    return prefRow.market_id as string;
  }
}
