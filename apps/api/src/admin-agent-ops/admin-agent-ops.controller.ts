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
  agentDeactivateSchema,
  agentListQuerySchema,
  agentSuspendSchema,
  type AgentDeactivateDto,
  type AgentListQueryDto,
  type AgentSuspendDto,
} from './admin-agent-ops.dto.js';
import { AdminAgentOpsService } from './admin-agent-ops.service.js';
import {
  AgentOpsError,
  type AgentDetailResponse,
  type AgentListResponse,
  type AgentOpsActor,
  type AgentStatusActionResultDto,
} from './admin-agent-ops.types.js';

/**
 * P7-S8 Admin Agent Operations adapter endpoints (Command Center 2026-08-07
 * §6.1).
 *
 * - `GET .../agents` — selected-market agent list/search (`agent.read`,
 *   marketScoped; GATE-P5-01): read projection over the frozen Phase 5
 *   `agent_activation` rows joined with the member identity, with the
 *   explicit capability state (`CONFIGURED` / `AGENT_FEE_NOT_CONFIGURED` —
 *   never a fallback fee).
 * - `GET .../agents/:agentId` — agent detail + append-only status history
 *   (`agent.read`).
 * - `POST .../agents/:agentId/suspend` — `agent.activation.manage`
 *   (marketScoped; mandatory reason): 1:1 delegation to the frozen owner
 *   command `AgentActivationService.suspend` with the server Current Admin
 *   Market (resolved to the market code) and the executing admin identity
 *   (P5-R1 actor attribution).
 * - `POST .../agents/:agentId/reactivate` — `agent.activation.manage`:
 *   1:1 delegation to the owner `reactivate` command.
 * - `POST .../agents/:agentId/deactivate` — `agent.activation.manage`
 *   (mandatory reason): 1:1 delegation to the owner `deactivate` command
 *   (terminal state).
 *
 * Market contract: canonical RbacGuard (all permissions marketScoped) — the
 * URL market must equal the server-owned Current Admin Market and the actor
 * must hold the market grant; client-supplied market disagreement returns
 * 409 `MARKET_CONTEXT_MISMATCH`.
 *
 * Agent Reapplication Policy is OPEN (not implemented): no reapplication
 * surface exists here.
 */
@ApiTags('Admin Agent Operations')
@ApiBearerAuth()
@Controller('admin/agent-ops')
@UseGuards(AuthGuard, RbacGuard)
export class AdminAgentOpsController {
  constructor(
    @Inject(AdminAgentOpsService)
    private readonly ops: AdminAgentOpsService,
  ) {}

  @Get('markets/:marketId/agents')
  @RequirePermission('agent.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Selected-market agent list/search (read projection).',
    description:
      'Market-scoped read projection of the frozen Phase 5 agent activation records joined with the member identity (public member id + display name), with status and free-text filters and pagination. The response carries the explicit capability state: a market is agent-capable only when an effective AGENT_ACTIVATION_FEE version exists; otherwise `AGENT_FEE_NOT_CONFIGURED` (no fallback fee). The URL market must equal the server Current Admin Market (409 otherwise).',
  })
  @ApiResponse({ status: 200, description: 'Agent list.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  listAgents(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(agentListQuerySchema))
    query: AgentListQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AgentListResponse> {
    return this.handle(() =>
      this.ops.listAgents(this.actor(actor, request, ip), marketId, query),
    );
  }

  @Get('markets/:marketId/agents/:agentId')
  @RequirePermission('agent.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Agent detail with append-only status history.',
    description:
      'Market-scoped agent detail: the activation record (must belong to the Current Admin Market) plus the member identity and the immutable owner status log (newest first). Read-only; no status transition is performed here.',
  })
  @ApiResponse({ status: 200, description: 'Agent detail.' })
  @ApiResponse({ status: 404, description: 'Agent or market not found.' })
  getAgent(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AgentDetailResponse> {
    return this.handle(() =>
      this.ops.getAgent(this.actor(actor, request, ip), marketId, agentId),
    );
  }

  @Post('markets/:marketId/agents/:agentId/suspend')
  @RequirePermission('agent.activation.manage', { marketScoped: true })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Suspend an ACTIVE agent (reason required).',
    description:
      'Delegates 1:1 to the frozen Phase 5 owner command AgentActivationService.suspend with the server Current Admin Market (resolved to the market code) and the executing admin identity. The owner validates the transition, the market consistency, the durable reason and appends the immutable status log entry. Invalid transitions return 409; unconfigured markets return 422 AGENT_FEE_NOT_CONFIGURED.',
  })
  @ApiResponse({ status: 200, description: 'Agent suspended.' })
  @ApiResponse({ status: 400, description: 'Missing or invalid reason.' })
  @ApiResponse({
    status: 409,
    description: 'Invalid transition or market mismatch.',
  })
  suspendAgent(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body(new ZodValidationPipe(agentSuspendSchema)) input: AgentSuspendDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AgentStatusActionResultDto> {
    return this.handle(() =>
      this.ops.suspendAgent(
        this.actor(actor, request, ip),
        marketId,
        agentId,
        input.reason,
      ),
    );
  }

  @Post('markets/:marketId/agents/:agentId/reactivate')
  @RequirePermission('agent.activation.manage', { marketScoped: true })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reactivate a SUSPENDED agent.',
    description:
      'Delegates 1:1 to the frozen Phase 5 owner command AgentActivationService.reactivate (SUSPENDED → ACTIVE; the owner increments the reactivation count and records the executing admin).',
  })
  @ApiResponse({ status: 200, description: 'Agent reactivated.' })
  @ApiResponse({
    status: 409,
    description: 'Invalid transition or market mismatch.',
  })
  reactivateAgent(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AgentStatusActionResultDto> {
    return this.handle(() =>
      this.ops.reactivateAgent(
        this.actor(actor, request, ip),
        marketId,
        agentId,
      ),
    );
  }

  @Post('markets/:marketId/agents/:agentId/deactivate')
  @RequirePermission('agent.activation.manage', { marketScoped: true })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Permanently deactivate an ACTIVE agent (reason required).',
    description:
      'Delegates 1:1 to the frozen Phase 5 owner command AgentActivationService.deactivate (terminal state; the owner records revoked_at/revoked_by/revocation_reason and the immutable status log entry).',
  })
  @ApiResponse({ status: 200, description: 'Agent deactivated.' })
  @ApiResponse({ status: 400, description: 'Missing or invalid reason.' })
  @ApiResponse({
    status: 409,
    description: 'Invalid transition or market mismatch.',
  })
  deactivateAgent(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body(new ZodValidationPipe(agentDeactivateSchema))
    input: AgentDeactivateDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AgentStatusActionResultDto> {
    return this.handle(() =>
      this.ops.deactivateAgent(
        this.actor(actor, request, ip),
        marketId,
        agentId,
        input.reason,
      ),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): AgentOpsActor {
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
      if (!(error instanceof AgentOpsError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'AGENT_MARKET_NOT_FOUND':
        case 'AGENT_NOT_FOUND':
          throw new NotFoundException(body);
        case 'PERMISSION_DENIED':
        case 'MARKET_ACCESS_DENIED':
        case 'AGENT_OWNERSHIP_MISMATCH':
        case 'AGENT_MARKET_MISMATCH':
          throw new ForbiddenException(body);
        case 'MARKET_SELECTION_REQUIRED':
        case 'MARKET_CONTEXT_MISMATCH':
        case 'AGENT_INVALID_TRANSITION':
        case 'AGENT_INVALID_STATUS':
        case 'AGENT_ALREADY_EXISTS':
        case 'AGENT_PAYMENT_ALREADY_CONFIRMED':
        case 'AGENT_COURSE_ALREADY_COMPLETED':
        case 'AGENT_ALREADY_ACTIVE':
        case 'AGENT_ALREADY_SUSPENDED':
        case 'AGENT_ALREADY_DEACTIVATED':
        case 'AGENT_ALREADY_REJECTED':
        case 'AGENT_DEACTIVATED_CANNOT_REACTIVATE':
        case 'AGENT_REJECTED_CANNOT_TRANSITION':
          throw new ConflictException(body);
        case 'REASON_REQUIRED':
        case 'AGENT_MISSING_PAYMENT':
        case 'AGENT_MISSING_COURSE':
        case 'AGENT_MISSING_APPROVAL':
          throw new BadRequestException(body);
        case 'AGENT_FEE_NOT_CONFIGURED':
          throw new UnprocessableEntityException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}
