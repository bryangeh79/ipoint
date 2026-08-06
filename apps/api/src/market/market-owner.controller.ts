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
  InternalServerErrorException,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
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
  updateMarketSchema,
  type UpdateMarketDto,
} from './market-owner.dto.js';
import { MarketOwnerService } from './market-owner.service.js';
import { MarketOwnerError } from './market-owner.types.js';
import type {
  MarketDetailResponse,
  MarketOwnerActor,
  UpdateMarketResponse,
} from './market-owner.types.js';

/**
 * P7-S6E Admin Market Configuration surface (Phase 7, secured market
 * owner).
 *
 * - `GET /api/v1/admin/market-ops/markets/:marketId` — selected-market
 *   registry read projection (`market.read`, ALL roles, marketScoped): id,
 *   code, name, status, currency, timezone, default locale, timestamps and
 *   the explicit blocked state (`configured: false` for a market that is
 *   not ACTIVE — never a fallback). The canonical RbacGuard is the first
 *   boundary: it requires the URL market to equal the server-owned Current
 *   Admin Market and an active grant on an ACTIVE market (403
 *   MARKET_ACCESS_DENIED otherwise).
 * - `PATCH /api/v1/admin/market-ops/markets/:marketId` — controlled
 *   update of the selected market (`market.manage`, SUPER_ADMIN only,
 *   marketScoped, step-up required via the canonical catalog): status
 *   (ACTIVE → INACTIVE with explicit `deactivationConfirmed` + dependency
 *   validation), name / currencyCode / timezone / defaultLocale with
 *   format validation. Mandatory Idempotency-Key (same key + same payload
 *   replays; same key + different payload 409) and mandatory reason. The
 *   owner (`MarketOwnerService.updateMarket`) re-checks every control
 *   in-process and commits the row update + idempotency claim + privileged
 *   audit in ONE transaction.
 *
 * The market contract is enforced by the canonical RbacGuard
 * (`marketScoped`): the URL market must equal the server-owned Current
 * Admin Market and the actor must hold the grant; any client-supplied
 * market disagreement returns 409 MARKET_CONTEXT_MISMATCH. The server
 * Current Admin Market (RbacGuard `adminMarketContext`) is passed into
 * the owner, which re-enforces the same contract in-process.
 */
@ApiTags('Admin Market Operations')
@ApiBearerAuth()
@Controller('admin/market-ops')
@UseGuards(AuthGuard, RbacGuard)
export class MarketOwnerController {
  constructor(
    @Inject(MarketOwnerService) private readonly owner: MarketOwnerService,
  ) {}

  @Get('markets/:marketId')
  @RequirePermission('market.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Selected-market registry read projection.',
    description:
      'Read-only projection of the selected market (market.read, all Admin roles, marketScoped): id, code, name, status, currency code, IANA timezone, default locale and timestamps. A market that is not ACTIVE is reported with the explicit blocked state (configured: false) — the surface never falls back to another market. Over HTTP the canonical RbacGuard denies non-ACTIVE markets with 403 first.',
  })
  @ApiResponse({ status: 200, description: 'Market detail.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 404, description: 'Market not found.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  getMarket(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
  ): Promise<MarketDetailResponse> {
    return this.handle(() => this.owner.getMarketDetail(marketId));
  }

  @Patch('markets/:marketId')
  @RequirePermission('market.manage', { marketScoped: true })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Controlled update of the selected market (Super Admin; step-up required).',
    description:
      'Secured market owner command (market.manage, SUPER_ADMIN only, marketScoped, step-up required): controlled fields only — status (ACTIVE → INACTIVE requires explicit deactivationConfirmed plus dependency validation), name (1..200), currencyCode (3 uppercase letters), timezone (valid IANA), defaultLocale (BCP-47-style). The Idempotency-Key header is mandatory: same key + same payload replays the original result; same key + different payload returns 409. The reason is mandatory. The owner commits the row update + idempotency claim + privileged audit in one transaction.',
  })
  @ApiResponse({ status: 200, description: 'Market updated.' })
  @ApiResponse({
    status: 400,
    description:
      'Invalid body, missing key/reason, no changes, invalid field, or missing deactivation confirmation.',
  })
  @ApiResponse({
    status: 403,
    description: 'Permission, step-up or market access denied.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Market selection/context mismatch, idempotency conflict, or deactivation dependency.',
  })
  updateMarket(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(updateMarketSchema))
    input: UpdateMarketDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<UpdateMarketResponse> {
    const idempotency = this.requireIdempotencyKey(idempotencyKey);
    return this.handle(() =>
      this.owner.updateMarket(this.actor(actor, request, ip), marketId, {
        ...input,
        idempotencyKey: idempotency,
      }),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): MarketOwnerActor {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      });
    }
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
    // Server-owned Current Admin Market resolved by the canonical RbacGuard
    // (marketScoped): passed through into the owner command so the update
    // gets the exact same selected-market enforcement as the canonical
    // route (P7-S1 market contract).
    const marketContext = (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext;
    return {
      adminUserId: actor.adminUserId,
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
      ...(marketContext
        ? {
            currentMarketId: marketContext.marketId,
            marketContextVersion: marketContext.contextVersion,
          }
        : {}),
    };
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key || key.length > 200) {
      throw new BadRequestException({
        code: 'MARKET_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof MarketOwnerError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'MARKET_PERMISSION_DENIED':
        case 'MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        case 'MARKET_NOT_FOUND':
          throw new NotFoundException(body);
        case 'MARKET_SELECTION_REQUIRED':
        case 'MARKET_CONTEXT_MISMATCH':
        case 'MARKET_IDEMPOTENCY_CONFLICT':
        case 'MARKET_DEACTIVATION_DEPENDENCY':
          throw new ConflictException(body);
        case 'MARKET_REASON_REQUIRED':
        case 'MARKET_IDEMPOTENCY_KEY_REQUIRED':
        case 'MARKET_NO_CHANGES':
        case 'MARKET_INVALID_FIELD':
        case 'MARKET_DEACTIVATION_CONFIRMATION_REQUIRED':
          throw new BadRequestException(body);
        case 'MARKET_UPDATE_FAILED':
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}
