/**
 * Referral Controller
 *
 * Handles referral registration and tree queries.
 * POST /api/v1/referral/register — system internal, called during member registration
 * GET  /api/v1/referral/tree      — returns anonymized referral tree
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
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { and, eq } from 'drizzle-orm';
import { members } from '@ipoint/database';
import type { ReferralTreeResponse } from '@ipoint/types';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ReferralService } from '../domain/referral/referral.service.js';
import { ReferralError } from '../domain/referral/referral.errors.js';
import {
  registerReferralSchema,
  referralTreeQuerySchema,
  type RegisterReferralDto,
  type ReferralTreeQueryDto,
} from '@ipoint/validation';

@ApiTags('Referral')
@ApiBearerAuth()
@Controller('referral')
@UseGuards(AuthGuard)
export class ReferralController {
  constructor(
    @Inject(ReferralService) private readonly referral: ReferralService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  // ─── Register Referral ────────────────────────────────────────────

  @Post('register')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Register a referral relationship',
    description:
      'System-internal endpoint called during member registration to link the new member (referee) to an existing member by referral code.',
  })
  @ApiResponse({ status: 200, description: 'Referral registered.' })
  async register(
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(registerReferralSchema))
    input: RegisterReferralDto,
  ) {
    const refereeId = await this.resolveMemberId(actor);
    return this.handle(() =>
      this.referral.registerReferral(refereeId, input.referralCode),
    );
  }

  // ─── Referral Tree ────────────────────────────────────────────────

  @Get('tree')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get anonymized referral tree',
    description:
      'Returns anonymized counts of direct (G1) and indirect (G2) referrals. No raw member IDs are exposed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Anonymized referral tree.',
  })
  async tree(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(referralTreeQuerySchema))
    query: ReferralTreeQueryDto,
  ): Promise<ReferralTreeResponse> {
    const memberId = await this.resolveMemberId(actor);
    return this.handle(() =>
      this.referral.getReferralTree(memberId, query.depth),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Resolve member ID from the authenticated actor's account ID.
   */
  private async resolveMemberId(
    actor: RequestActor | undefined,
  ): Promise<string> {
    if (actor?.type !== 'ACCOUNT' || !actor.accountId) {
      throw new UnauthorizedException({
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
        code: 'REFERRAL_MEMBER_NOT_FOUND',
        message: 'Member profile not found.',
      });
    }

    return member.id;
  }

  /**
   * Map domain errors to HTTP exceptions.
   */
  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ReferralError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'REFERRAL_CODE_NOT_FOUND':
          throw new NotFoundException(body);
        case 'REFERRAL_SELF_REFERENCE':
        case 'REFERRAL_CYCLE_DETECTED':
        case 'REFERRAL_ALREADY_EXISTS':
          throw new ConflictException(body);
        default:
          throw new BadRequestException(body);
      }
    }
  }
}
