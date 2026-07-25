/**
 * Agent Commission Query Controller (P5-S6)
 *
 * Agent-facing commission ledger and summary endpoints.
 * Auth is extracted from the authenticated actor principal — never from
 * request body. All monetary amounts returned as decimal strings with
 * trailing zeros (2dp for MYR/SGD).
 *
 * @packageDocumentation
 */

import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
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
import { CommissionQueryService } from '../domain/commission/query.service.js';
import { DatabaseService } from '../database/database.service.js';
import { and, eq } from 'drizzle-orm';
import { members } from '@ipoint/database';

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('Agent Commission')
@ApiBearerAuth()
@Controller('api/v1/commission')
@UseGuards(AuthGuard)
export class AgentCommissionController {
  constructor(
    @Inject(CommissionQueryService)
    private readonly query: CommissionQueryService,
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
  ) {}

  // ─── Get Ledger ───────────────────────────────────────────────

  @Get('ledger')
  @ApiOperation({
    summary: 'Get paginated commission ledger for the authenticated member',
  })
  @ApiQuery({
    name: 'market',
    required: false,
    description: 'Filter by market code (MY, SG)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by posting status (EARNED, REVERSED, COMPENSATED)',
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
    description: 'Paginated ledger entries',
  })
  async getLedger(
    @CurrentActor() actor: RequestActor | undefined,
    @Query('market') market?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const memberId = await this.resolveMemberId(actor);

    return this.query.getLedger(memberId, {
      market,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  // ─── Get Ledger Detail ────────────────────────────────────────

  @Get('ledger/:entryId')
  @ApiOperation({
    summary: 'Get a single commission ledger entry by ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Ledger entry detail',
  })
  @ApiResponse({
    status: 404,
    description: 'Entry not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Entry does not belong to the authenticated member',
  })
  async getLedgerDetail(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('entryId') entryId: string,
  ) {
    const memberId = await this.resolveMemberId(actor);

    try {
      return await this.query.getLedgerDetail(entryId, memberId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw error;
    }
  }

  // ─── Get Summary ──────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({
    summary: 'Get per-market commission summary for the authenticated member',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-market commission totals with grand total',
  })
  async getSummary(@CurrentActor() actor: RequestActor | undefined) {
    const memberId = await this.resolveMemberId(actor);

    return this.query.getSummary(memberId);
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Resolve member UUID from the authenticated actor's account ID.
   *
   * Auth from principal — never from request body.
   *
   * @throws ForbiddenException if the actor is not a valid member
   */
  private async resolveMemberId(
    actor: RequestActor | undefined,
  ): Promise<string> {
    if (actor?.type !== 'ACCOUNT' || !actor.accountId) {
      throw new ForbiddenException({
        code: 'AUTH_SESSION_INVALID',
        message: 'A valid member session is required.',
      });
    }

    const rows = await this.database.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.accountId, actor.accountId)))
      .limit(1);

    const member = rows[0];
    if (!member) {
      throw new ForbiddenException({
        code: 'COMMISSION_MEMBER_NOT_FOUND',
        message: 'Member profile not found.',
      });
    }

    return member.id;
  }
}
