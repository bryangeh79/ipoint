/**
 * Admin Commission & Adjustment Controllers (P5-S6)
 *
 * Admin-facing commission ledger search, audit log, reprocessing, and
 * adjustment maker/checker workflow.
 *
 * ## Key Rules (FROZEN)
 * - Auth from principal — never from request body
 * - Two-person rule (maker/checker) enforced in the domain service
 * - All amounts returned as decimal strings with trailing zeros
 *
 * @packageDocumentation
 */

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
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import { CommissionQueryService } from '../domain/commission/query.service.js';
import {
  AdjustmentService,
  AdjustmentError,
} from '../domain/commission/adjustment.service.js';
import {
  AgentUpgradeCommissionService,
  MemberConsumptionCommissionService,
  MerchantRecruitmentCommissionService,
} from '../domain/commission/index.js';

/* ================================================================== */
/*  Admin Commission Controller                                       */
/* ================================================================== */

@ApiTags('Admin Commission')
@ApiBearerAuth()
@Controller('api/v1/admin/commission')
@UseGuards(AuthGuard, RbacGuard)
export class AdminCommissionController {
  constructor(
    @Inject(CommissionQueryService)
    private readonly query: CommissionQueryService,
    @Inject(AdjustmentService)
    private readonly adjustment: AdjustmentService,
    @Inject(AgentUpgradeCommissionService)
    private readonly agentUpgrade: AgentUpgradeCommissionService,
    @Inject(MemberConsumptionCommissionService)
    private readonly memberConsumption: MemberConsumptionCommissionService,
    @Inject(MerchantRecruitmentCommissionService)
    private readonly merchantRecruitment: MerchantRecruitmentCommissionService,
  ) {}

  // ─── Search Ledger ────────────────────────────────────────────

  @Get('ledger')
  @RequirePermission('commission.read')
  @ApiOperation({
    summary: 'Admin search across all commission ledger entries',
  })
  @ApiQuery({
    name: 'beneficiaryId',
    required: false,
    description: 'Filter by beneficiary member UUID',
  })
  @ApiQuery({
    name: 'market',
    required: false,
    description: 'Filter by market code (MY, SG)',
  })
  @ApiQuery({
    name: 'sourceType',
    required: false,
    description: 'Filter by source type',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by posting status',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Filter by effective time start (ISO 8601)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Filter by effective time end (ISO 8601)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (default 20, max 100)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Zero-based page offset',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated ledger entries with beneficiary details',
  })
  async searchLedger(
    @CurrentActor() _actor: RequestActor | undefined,
    @Query('beneficiaryId') beneficiaryId?: string,
    @Query('market') market?: string,
    @Query('sourceType') sourceType?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Admin auth is enforced by RbacGuard; the actor is not needed
    // for data filtering since admin searches are unconstrained.

    return this.query.adminSearch({
      beneficiaryId,
      market,
      sourceType,
      status,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  // ─── Get Audit Log ────────────────────────────────────────────

  @Get('audit')
  @RequirePermission('commission.read')
  @ApiOperation({
    summary: 'Get status event history for a commission ledger entry',
  })
  @ApiQuery({
    name: 'entryId',
    required: true,
    description: 'Commission ledger entry UUID',
  })
  @ApiResponse({
    status: 200,
    description: 'Ordered list of status audit events',
  })
  @ApiResponse({
    status: 404,
    description: 'Entry not found',
  })
  async getAuditLog(
    @CurrentActor() _actor: RequestActor | undefined,
    @Query('entryId') entryId: string,
  ) {
    if (!entryId) {
      throw new BadRequestException({
        code: 'COMMISSION_MISSING_ENTRY_ID',
        message: 'entryId query parameter is required.',
      });
    }

    try {
      return await this.query.getAuditLog(entryId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw error;
    }
  }

  // ─── Reprocess Commission ─────────────────────────────────────

  @Post('reprocess')
  @RequirePermission('commission.read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reprocess commission calculation for a source event',
  })
  @ApiResponse({
    status: 200,
    description: 'Reprocessing result',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid source type or missing reference',
  })
  async reprocess(
    @CurrentActor() _actor: RequestActor | undefined,
    @Body()
    body: {
      /** The source type discriminator (e.g. AGENT_ACTIVATION, MEMBER_CONSUMPTION, MERCHANT_TRANSACTION). */
      sourceType: string;
      /** The source event UUID (e.g. transaction ID, activation ID). */
      sourceReference: string;
    },
  ) {
    const { sourceType, sourceReference } = body;

    if (!sourceType || !sourceReference) {
      throw new BadRequestException({
        code: 'COMMISSION_REPROCESS_MISSING_FIELDS',
        message: 'sourceType and sourceReference are required.',
      });
    }

    switch (sourceType) {
      case 'AGENT_ACTIVATION':
        return this.agentUpgrade.processAgentUpgrade(sourceReference);
      case 'MEMBER_CONSUMPTION':
        return this.memberConsumption.processMemberConsumption(sourceReference);
      case 'MERCHANT_TRANSACTION':
        return this.merchantRecruitment.processMerchantRecruitment(
          sourceReference,
        );
      default:
        throw new BadRequestException({
          code: 'COMMISSION_UNKNOWN_SOURCE_TYPE',
          message: `Unknown source type: ${sourceType}. Supported types: AGENT_ACTIVATION, MEMBER_CONSUMPTION, MERCHANT_TRANSACTION.`,
        });
    }
  }
}

/* ================================================================== */
/*  Admin Adjustment Controller                                       */
/* ================================================================== */

@ApiTags('Admin Commission Adjustments')
@ApiBearerAuth()
@Controller('api/v1/admin/commission-adjustments')
@UseGuards(AuthGuard, RbacGuard)
export class AdminAdjustmentController {
  constructor(
    @Inject(AdjustmentService)
    private readonly adjustment: AdjustmentService,
  ) {}

  // ─── Create Adjustment (Maker) ─────────────────────────────────

  @Post()
  @RequirePermission('commission.adjustment.maker')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create a new admin adjustment request (Maker action)',
    description:
      'Creates a PENDING_CHECKER adjustment request. The maker_id is ' +
      'extracted from the auth principal (not from the request body). ' +
      'Zero amount is rejected.',
  })
  @ApiResponse({
    status: 200,
    description: 'Adjustment request created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error (e.g. zero amount, missing fields)',
  })
  async create(
    @CurrentActor() actor: RequestActor | undefined,
    @Body()
    body: {
      /** The member UUID receiving the adjustment. */
      beneficiaryId: string;
      /** Adjustment amount as a decimal string (positive = credit, negative = debit). Must be non-zero. */
      amount: string;
      /** Market code (e.g. MY, SG). */
      market: string;
      /** Currency code (e.g. MYR, SGD). */
      currency: string;
      /** Human-readable reason for the adjustment. */
      reason: string;
      /** Optional external audit reference. */
      auditReference?: string;
    },
  ) {
    const adminId = this.resolveAdminId(actor);

    const { beneficiaryId, amount, market, currency, reason, auditReference } =
      body;

    if (!beneficiaryId || !amount || !market || !currency || !reason) {
      throw new BadRequestException({
        code: 'COMMISSION_ADJUSTMENT_MISSING_FIELDS',
        message:
          'beneficiaryId, amount, market, currency, and reason are required.',
      });
    }

    return this.handleAdjustment(() =>
      this.adjustment.createAdjustment(
        adminId,
        beneficiaryId,
        amount,
        market,
        currency,
        reason,
        auditReference,
      ),
    );
  }

  // ─── Approve Adjustment (Checker) ──────────────────────────────

  @Post(':id/approve')
  @RequirePermission('commission.adjustment.checker')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve a pending adjustment request (Checker action)',
    description:
      'Creates a commission ledger entry (ADMIN_ADJUSTMENT), a status ' +
      'event, and updates the adjustment request to APPROVED. All within ' +
      'a single atomic transaction. The checker_id is extracted from the ' +
      'auth principal — never from the request body.',
  })
  @ApiResponse({
    status: 200,
    description: 'Adjustment approved and ledger entry created',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error (e.g. same maker and checker)',
  })
  @ApiResponse({
    status: 404,
    description: 'Adjustment request not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict (already decided or not in PENDING_CHECKER status)',
  })
  async approve(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id') id: string,
  ) {
    const adminId = this.resolveAdminId(actor);

    return this.handleAdjustment(() =>
      this.adjustment.approveAdjustment(adminId, id),
    );
  }

  // ─── Reject Adjustment (Checker) ───────────────────────────────

  @Post(':id/reject')
  @RequirePermission('commission.adjustment.checker')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject a pending adjustment request (Checker action)',
    description:
      'Sets the adjustment status to REJECTED. No ledger entry is created. ' +
      'The checker_id is extracted from the auth principal. An optional ' +
      'rejection reason is stored in checkerNotes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Adjustment rejected',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error (e.g. same maker and checker)',
  })
  @ApiResponse({
    status: 404,
    description: 'Adjustment request not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict (already decided or not in PENDING_CHECKER status)',
  })
  async reject(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const adminId = this.resolveAdminId(actor);

    return this.handleAdjustment(() =>
      this.adjustment.rejectAdjustment(adminId, id, body?.reason),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Extract and validate the admin user ID from the auth actor.
   *
   * Auth from principal — never from request body.
   *
   * @throws ForbiddenException if the actor is not a valid admin user
   */
  private resolveAdminId(actor: RequestActor | undefined): string {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'AUTH_PERMISSION_DENIED',
        message: 'An administrator session is required.',
      });
    }
    return actor.adminUserId;
  }

  /**
   * Map domain AdjustmentErrors to appropriate HTTP exceptions.
   */
  private async handleAdjustment<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AdjustmentError)) throw error;

      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };

      switch (error.code) {
        case 'ADJUSTMENT_NOT_FOUND':
          throw new NotFoundException(body);
        case 'ADJUSTMENT_INVALID_AMOUNT':
        case 'ADJUSTMENT_CHECKER_REQUIRED':
          throw new BadRequestException(body);
        case 'ADJUSTMENT_MAKER_CHECKER_SAME':
          throw new ForbiddenException(body);
        case 'ADJUSTMENT_ALREADY_DECIDED':
        case 'ADJUSTMENT_INVALID_STATUS':
          throw new ConflictException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}
