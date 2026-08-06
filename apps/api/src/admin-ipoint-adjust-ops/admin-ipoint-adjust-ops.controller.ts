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
import { WalletAdjustmentOwnerError } from '../wallet/wallet-adjustment.owner.types.js';
import {
  createIpointAdjustmentSchema,
  ipointAdjustmentDecisionSchema,
  ipointAdjustmentQueueQuerySchema,
  ipointWalletLookupQuerySchema,
  type CreateIpointAdjustmentDto,
  type IpointAdjustmentDecisionDto,
  type IpointAdjustmentQueueQueryDto,
  type IpointWalletLookupQueryDto,
} from './admin-ipoint-adjust-ops.dto.js';
import { AdminIpointAdjustOpsService } from './admin-ipoint-adjust-ops.service.js';
import type {
  AdminIpointAdjustOpsActor,
  AdminIpointAdjustmentConfigResponse,
  AdminIpointAdjustmentCreateResponse,
  AdminIpointAdjustmentDecisionResponse,
  AdminIpointAdjustmentDetailResponse,
  AdminIpointAdjustmentQueueResponse,
  AdminIpointWalletLookupDto,
} from './admin-ipoint-adjust-ops.types.js';

/**
 * P7-S7B Admin iPoint Adjustment Operations adapter endpoints (SEC-01 §6 /
 * P7-S1 §17, P7-OD-03/10/11/18/20).
 *
 * - `POST .../adjustments` — Maker create (`wallet.ipoint.adjust.maker`,
 *   marketScoped, mandatory Idempotency-Key). The adapter performs ONLY
 *   transport validation and delegates the entire create to the frozen
 *   SEC-01 owner (`WalletAdjustmentOwnerService.create`): RBAC re-check,
 *   selected-market enforcement, caps routing, evidence rules, payload-
 *   hash idempotency, atomic audit. Same key + same payload replays the
 *   stored DRAFT; same key + different payload returns 409.
 * - `POST .../adjustments/:requestId/submit` — Maker submit (DRAFT →
 *   SUBMITTED).
 * - `POST .../adjustments/:requestId/decision` — Checker decide
 *   (`wallet.ipoint.adjust.checker`, marketScoped, step-up required via
 *   catalog; `x-step-up-token` consumed by the canonical RbacGuard).
 *   APPROVED | REJECTED only — no auto-execute (D-046 separate decide and
 *   execute boundaries).
 * - `POST .../adjustments/:requestId/execute` — Checker execute
 *   (`wallet.ipoint.adjust.execute`, step-up required via catalog).
 * - `GET .../adjustments` — Finance queue projection
 *   (`wallet.ipoint.read`, marketScoped): state-filterable, paginated,
 *   newest first.
 * - `GET .../adjustments/:requestId` — Request detail incl. the immutable
 *   decision history.
 * - `GET .../config` — Maker-form support projection: versioned per-market
 *   caps + secure-evidence capability and the active reason-code catalog.
 *   A market without a rules row is reported with the explicit blocked
 *   state (`configured: false` — no fallback).
 * - `GET .../wallets` — Wallet/member lookup for the maker screen
 *   (masked identity + balance; never evidence contents).
 *
 * The market contract is enforced by the canonical RbacGuard
 * (`marketScoped`): the URL market must equal the server-owned Current
 * Admin Market and the actor must hold the market grant; any client-
 * supplied market disagreement returns 409 `MARKET_CONTEXT_MISMATCH`.
 * The frozen owner command re-enforces the same contract in-process.
 */
@ApiTags('Admin iPoint Adjustment Operations')
@ApiBearerAuth()
@Controller('admin/ipoint-adjust-ops')
@UseGuards(AuthGuard, RbacGuard)
export class AdminIpointAdjustOpsController {
  constructor(
    @Inject(AdminIpointAdjustOpsService)
    private readonly ops: AdminIpointAdjustOpsService,
  ) {}

  @Post('markets/:marketId/adjustments')
  @HttpCode(201)
  @RequirePermission('wallet.ipoint.adjust.maker', { marketScoped: true })
  @ApiOperation({
    summary:
      'Create a manual iPoint adjustment request (Maker; durable DRAFT).',
    description:
      'Phase 7 transport boundary over the frozen SEC-01 owner: the adapter validates the field shapes only and delegates the entire create (RBAC re-check, selected-market enforcement, caps routing, evidence rules, payload-hash idempotency, atomic audit) to WalletAdjustmentOwnerService.create. The Idempotency-Key header is mandatory: same key + same payload replays the stored request; same key + different payload returns 409. The request is created in DRAFT state and must be submitted by the maker before a checker may decide.',
  })
  @ApiResponse({ status: 201, description: 'Adjustment request created.' })
  @ApiResponse({ status: 400, description: 'Invalid body or missing key.' })
  @ApiResponse({
    status: 409,
    description: 'Idempotency conflict or market context mismatch.',
  })
  @ApiResponse({
    status: 422,
    description: 'Caps / evidence / reason-code validation failed.',
  })
  create(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createIpointAdjustmentSchema))
    input: CreateIpointAdjustmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminIpointAdjustmentCreateResponse> {
    return this.handle(() =>
      this.ops.create(this.actor(actor, request, ip), {
        walletAccountId: input.walletAccountId,
        direction: input.direction,
        amount: input.amount,
        reasonCode: input.reasonCode,
        explanation: input.explanation,
        caseReference: input.caseReference,
        ...(input.attachmentReference
          ? { attachmentReference: input.attachmentReference }
          : {}),
        ...(input.priorRequestId
          ? { priorRequestId: input.priorRequestId }
          : {}),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
    );
  }

  @Post('markets/:marketId/adjustments/:requestId/submit')
  @HttpCode(200)
  @RequirePermission('wallet.ipoint.adjust.maker', { marketScoped: true })
  @ApiOperation({
    summary: 'Submit an adjustment request for checker review (Maker).',
    description:
      'DRAFT -> SUBMITTED. The frozen owner enforces maker identity (only the request maker may submit) and the selected-market contract.',
  })
  @ApiResponse({ status: 200, description: 'Request submitted.' })
  @ApiResponse({ status: 403, description: 'Permission or maker required.' })
  @ApiResponse({ status: 404, description: 'Request not found.' })
  @ApiResponse({ status: 409, description: 'State or market conflict.' })
  submit(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminIpointAdjustmentDecisionResponse> {
    return this.handle(() =>
      this.ops.submit(this.actor(actor, request, ip), requestId),
    );
  }

  @Post('markets/:marketId/adjustments/:requestId/decision')
  @HttpCode(200)
  @RequirePermission('wallet.ipoint.adjust.checker', { marketScoped: true })
  @ApiOperation({
    summary: 'Decide an adjustment request (Checker; step-up required).',
    description:
      'SUBMITTED -> APPROVED | REJECTED. The frozen owner enforces checker identity (never the maker, at every amount incl. Super Admin), caps routing (above soft cap: Super Admin checker only), evidence rules (attachment mandatory above soft cap / high-risk code / checker request), and writes the immutable decision row + audit atomically. Requires a fresh step-up grant via the x-step-up-token header (catalog stepUpRequired). Rejected requests are immutable (P7-OD-18).',
  })
  @ApiResponse({ status: 200, description: 'Decision recorded.' })
  @ApiResponse({
    status: 403,
    description: 'Permission, step-up, routing or Maker≠Checker denial.',
  })
  @ApiResponse({ status: 404, description: 'Request not found.' })
  @ApiResponse({ status: 409, description: 'State or market conflict.' })
  @ApiResponse({
    status: 422,
    description: 'Caps / evidence validation failed.',
  })
  decide(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(ipointAdjustmentDecisionSchema))
    input: IpointAdjustmentDecisionDto,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminIpointAdjustmentDecisionResponse> {
    return this.handle(() =>
      this.ops.decide(this.actor(actor, request, ip), requestId, {
        decision: input.decision,
        reason: input.reason,
        requireAttachment: input.requireAttachment,
      }),
    );
  }

  @Post('markets/:marketId/adjustments/:requestId/execute')
  @HttpCode(200)
  @RequirePermission('wallet.ipoint.adjust.execute', { marketScoped: true })
  @ApiOperation({
    summary:
      'Execute an approved adjustment request (Checker; step-up required).',
    description:
      'APPROVED -> EXECUTING -> EXECUTED | FAILED. The frozen owner revalidates everything inside the execution boundary (target, amount, evidence, limits, Maker≠Checker inequality, caps) and appends the dedicated direction-aware wallet ledger entry + request state + immutable audit atomically in ONE transaction. Above-soft-cap execution stays disabled until secure evidence storage is enabled for the market (P7-OD-11; `WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE`). Requires a fresh step-up grant via the x-step-up-token header.',
  })
  @ApiResponse({ status: 200, description: 'Execution result.' })
  @ApiResponse({
    status: 403,
    description: 'Permission, step-up or Maker≠Checker denial.',
  })
  @ApiResponse({ status: 404, description: 'Request not found.' })
  @ApiResponse({ status: 409, description: 'State or market conflict.' })
  @ApiResponse({
    status: 422,
    description: 'Caps / evidence / balance validation failed.',
  })
  execute(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminIpointAdjustmentDecisionResponse> {
    return this.handle(() =>
      this.ops.execute(this.actor(actor, request, ip), requestId),
    );
  }

  @Get('markets/:marketId/adjustments')
  @RequirePermission('wallet.ipoint.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Finance iPoint adjustment queue projection.',
    description:
      'Bounded, market-scoped, state-filterable queue of durable iPoint adjustment requests (newest first). Read-only projection over the frozen request rows; the owner remains the enforcement boundary.',
  })
  @ApiResponse({ status: 200, description: 'Queue projection.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  queue(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(ipointAdjustmentQueueQuerySchema))
    query: IpointAdjustmentQueueQueryDto,
  ): Promise<AdminIpointAdjustmentQueueResponse> {
    return this.handle(() =>
      this.ops.listForMarket(marketId, {
        state: query.state,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }

  @Get('markets/:marketId/adjustments/:requestId')
  @RequirePermission('wallet.ipoint.read', { marketScoped: true })
  @ApiOperation({
    summary: 'iPoint adjustment request detail incl. decision history.',
    description:
      'The request projection plus the immutable decision history (P7-OD-11/18) for the selected market.',
  })
  @ApiResponse({ status: 200, description: 'Request detail.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 404, description: 'Request not found.' })
  detail(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ): Promise<AdminIpointAdjustmentDetailResponse> {
    return this.handle(() => this.ops.detail(marketId, requestId));
  }

  @Get('markets/:marketId/config')
  @RequirePermission('wallet.ipoint.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Maker-form support projection (market rules + reason codes).',
    description:
      'Versioned per-market caps + secure-evidence capability (P7-OD-10/11) and the active reason-code catalog for the maker screen. A market without a rules row is reported with the explicit blocked state (configured: false) — no fallback to any other market.',
  })
  @ApiResponse({ status: 200, description: 'Market rules + reason codes.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 404, description: 'Market not found.' })
  config(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
  ): Promise<AdminIpointAdjustmentConfigResponse> {
    return this.handle(() => this.ops.config(marketId));
  }

  @Get('markets/:marketId/wallets')
  @RequirePermission('wallet.ipoint.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Wallet/member lookup for the maker screen.',
    description:
      'Masked wallet/member lookup within the selected market (public member id, display name, available balance). Never returns evidence contents or raw credentials.',
  })
  @ApiResponse({ status: 200, description: 'Wallet matches.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 404, description: 'No wallet matched.' })
  wallets(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(ipointWalletLookupQuerySchema))
    query: IpointWalletLookupQueryDto,
  ): Promise<AdminIpointWalletLookupDto[]> {
    return this.handle(() =>
      this.ops.searchWallets(marketId, query.query, query.limit),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): AdminIpointAdjustOpsActor {
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
    // (marketScoped): passed through into the frozen owner command so every
    // command gets the exact same selected-market enforcement as the
    // canonical route (SEC-01 §6.3 contract).
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
        code: 'WALLET_ADJUSTMENT_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  /**
   * Frozen SEC-01 owner error -> HTTP mapping (SEC-01 §6.4 / S7A §7.4
   * accepted pattern). Every `WalletAdjustmentOwnerError` code maps to its
   * contract status; unknown errors propagate unchanged (never swallowed,
   * never mapped to 2xx).
   */
  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof WalletAdjustmentOwnerError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'WALLET_ADJUSTMENT_PERMISSION_DENIED':
        case 'WALLET_ADJUSTMENT_MARKET_ACCESS_DENIED':
        case 'WALLET_ADJUSTMENT_MAKER_REQUIRED':
        case 'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT':
        case 'WALLET_ADJUSTMENT_CHECKER_ROUTING_DENIED':
          throw new ForbiddenException(body);
        case 'WALLET_ADJUSTMENT_WALLET_NOT_FOUND':
        case 'WALLET_ADJUSTMENT_REQUEST_NOT_FOUND':
        case 'WALLET_ADJUSTMENT_MARKET_NOT_FOUND':
        case 'WALLET_ADJUSTMENT_WALLET_LOOKUP_EMPTY':
          throw new NotFoundException(body);
        case 'WALLET_ADJUSTMENT_MARKET_SELECTION_REQUIRED':
        case 'WALLET_ADJUSTMENT_MARKET_CONTEXT_MISMATCH':
        case 'WALLET_ADJUSTMENT_IDEMPOTENCY_CONFLICT':
        case 'WALLET_ADJUSTMENT_STATE_CONFLICT':
        case 'WALLET_ADJUSTMENT_PRIOR_REQUEST_INVALID':
          throw new ConflictException(body);
        case 'WALLET_ADJUSTMENT_IDEMPOTENCY_KEY_REQUIRED':
        case 'WALLET_ADJUSTMENT_INVALID_FIELD':
        case 'WALLET_ADJUSTMENT_DECISION_REASON_REQUIRED':
        case 'WALLET_ADJUSTMENT_INVALID_AMOUNT':
          throw new BadRequestException(body);
        case 'WALLET_ADJUSTMENT_MARKET_NOT_CONFIGURED':
        case 'WALLET_ADJUSTMENT_ABOVE_HARD_CAP':
        case 'WALLET_ADJUSTMENT_REASON_CODE_INVALID':
        case 'WALLET_ADJUSTMENT_ATTACHMENT_REQUIRED':
        case 'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE':
        case 'WALLET_ADJUSTMENT_INSUFFICIENT_BALANCE':
          throw new UnprocessableEntityException(body);
        // Server-side execution failure (ledger append failed, request
        // durably FAILED): not a client-correctable business error, so it
        // surfaces as 500 but keeps the owner code for observability.
        case 'WALLET_ADJUSTMENT_EXECUTION_FAILED':
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}
