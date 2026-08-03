import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { markets } from '@ipoint/database';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import { AgentActivationService } from '../domain/agent-activation/service.js';
import { AgentActivationError } from '../domain/agent-activation/agent-activation.errors.js';
import { AgentUpgradeCommissionService } from '../domain/commission/agent-upgrade.service.js';
import {
  deactivateSchema,
  rejectSchema,
  suspendSchema,
  type DeactivateDto,
  type RejectDto,
  type SuspendDto,
} from './agent-activation.dto.js';

// ---------------------------------------------------------------------------
// Controller
//
// P5-R1 (GATE-P5-01):
// - Single canonical mount: global prefix `api/v1` + `admin/agent-activations`
//   (the legacy doubled `api/v1/api/v1/admin/...` mount is retired).
// - RbacGuard enforces `agent.activation.manage` (market-scoped definition)
//   and the server-owned Current Admin Market.
// - Every command re-validates that the activation belongs to the selected
//   market and records the executing admin (actor attribution).
// - Commission posting failures are surfaced explicitly (never swallowed);
//   the activation itself commits atomically and the posting can be retried
//   idempotently via the canonical reprocess command.
// ---------------------------------------------------------------------------

@ApiTags('Admin Agent Activations')
@ApiBearerAuth()
@Controller('admin/agent-activations')
@UseGuards(AuthGuard, RbacGuard)
export class AdminAgentActivationController {
  constructor(
    @Inject(AgentActivationService)
    private readonly activation: AgentActivationService,
    @Inject(AgentUpgradeCommissionService)
    private readonly commission: AgentUpgradeCommissionService,
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
  ) {}

  // ─── Approve and Activate ─────────────────────────────────────

  @Post(':id/approve')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve and activate agent application' })
  @ApiResponse({ status: 200, description: 'Agent activated.' })
  @ApiResponse({
    status: 502,
    description:
      'Activation committed but commission posting failed; retry idempotently via the reprocess command.',
  })
  async approve(
    @Param('id') id: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ) {
    const adminId = this.resolveAdminId(actor);
    const marketCode = await this.resolveMarketCode(request);

    // Atomic activation transition (commits ACTIVE + audit together).
    await this.activation.approveAndActivate(id, adminId, marketCode);

    // Agent upgrade commission posting: idempotent via canonical processing
    // key. A failure here must be surfaced (no partial/false success) and
    // retried through the canonical reprocess command. It never rolls back
    // the committed activation.
    try {
      await this.commission.processAgentUpgrade(id);
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'COMMISSION_POSTING_FAILED',
        message:
          'Activation committed, but the agent upgrade commission posting failed. Retry with the reprocess command (same source reference is idempotent).',
        details: {
          activationId: id,
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }

    return { success: true, activationId: id };
  }

  // ─── Reject ───────────────────────────────────────────────────

  @Post(':id/reject')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject agent activation application' })
  @ApiResponse({ status: 200, description: 'Application rejected.' })
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) input: RejectDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ) {
    const adminId = this.resolveAdminId(actor);
    return this.handle(async () => {
      const marketCode = await this.resolveMarketCode(request);
      await this.activation.reject(id, adminId, marketCode, input.reason);
    });
  }

  // ─── Suspend ──────────────────────────────────────────────────

  @Post(':id/suspend')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend an active agent' })
  @ApiResponse({ status: 200, description: 'Agent suspended.' })
  suspend(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(suspendSchema)) input: SuspendDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ) {
    const adminId = this.resolveAdminId(actor);
    return this.handle(async () => {
      const marketCode = await this.resolveMarketCode(request);
      await this.activation.suspend(id, adminId, marketCode, input.reason);
    });
  }

  // ─── Reactivate ───────────────────────────────────────────────

  @Post(':id/reactivate')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reactivate a suspended agent' })
  @ApiResponse({ status: 200, description: 'Agent reactivated.' })
  reactivate(
    @Param('id') id: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ) {
    const adminId = this.resolveAdminId(actor);
    return this.handle(async () => {
      const marketCode = await this.resolveMarketCode(request);
      await this.activation.reactivate(id, adminId, marketCode);
    });
  }

  // ─── Deactivate ───────────────────────────────────────────────

  @Post(':id/deactivate')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Permanently deactivate an active agent' })
  @ApiResponse({ status: 200, description: 'Agent deactivated.' })
  deactivate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deactivateSchema)) input: DeactivateDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ) {
    const adminId = this.resolveAdminId(actor);
    return this.handle(async () => {
      const marketCode = await this.resolveMarketCode(request);
      await this.activation.deactivate(id, adminId, marketCode, input.reason);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Extract and validate the admin user ID from the auth actor.
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
   * Resolve the server-selected Current Admin Market code.
   *
   * The RbacGuard (market-scoped permission definition) resolves the
   * selected market id and verifies the active grant; this helper only
   * maps that server-owned id to its code. A client-provided market is
   * never consulted.
   */
  private async resolveMarketCode(request: Request): Promise<string> {
    const context = (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext;
    if (!context?.marketId) {
      throw new ForbiddenException({
        code: 'MARKET_SELECTION_REQUIRED',
        message: 'Select an authorized market to continue.',
      });
    }
    const rows = await this.database.db
      .select({ code: markets.code })
      .from(markets)
      .where(eq(markets.id, context.marketId))
      .limit(1);
    const code = rows[0]?.code;
    if (!code) {
      throw new ForbiddenException({
        code: 'MARKET_SELECTION_REQUIRED',
        message: 'The selected market is not available.',
      });
    }
    return code;
  }

  /**
   * Map domain errors to HTTP exceptions.
   */
  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AgentActivationError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'AGENT_ACTIVATION_NOT_FOUND':
          throw new NotFoundException(body);
        case 'AGENT_ACTIVATION_ALREADY_EXISTS':
        case 'AGENT_ACTIVATION_PAYMENT_ALREADY_CONFIRMED':
        case 'AGENT_ACTIVATION_COURSE_ALREADY_COMPLETED':
        case 'AGENT_ACTIVATION_IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
        case 'AGENT_ACTIVATION_MISSING_PAYMENT':
        case 'AGENT_ACTIVATION_MISSING_COURSE':
        case 'AGENT_ACTIVATION_MISSING_APPROVAL':
        case 'AGENT_ACTIVATION_FEE_NOT_CONFIGURED':
          throw new BadRequestException(body);
        case 'AGENT_ACTIVATION_OWNERSHIP_MISMATCH':
        case 'AGENT_ACTIVATION_MARKET_MISMATCH':
          throw new ForbiddenException(body);
        case 'AGENT_ACTIVATION_INVALID_TRANSITION':
        case 'AGENT_ACTIVATION_INVALID_STATUS':
        case 'AGENT_ACTIVATION_ALREADY_ACTIVE':
        case 'AGENT_ACTIVATION_ALREADY_SUSPENDED':
        case 'AGENT_ACTIVATION_ALREADY_DEACTIVATED':
        case 'AGENT_ACTIVATION_ALREADY_REJECTED':
        case 'AGENT_ACTIVATION_DEACTIVATED_CANNOT_REACTIVATE':
        case 'AGENT_ACTIVATION_REJECTED_CANNOT_TRANSITION':
          throw new ConflictException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}
