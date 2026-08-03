import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Ip,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import { AdminMemberError } from '../admin-member/admin-member.types.js';
import {
  addAdminNoteSchema,
  closeMemberSchema,
  reactivateMemberSchema,
  requireReverificationSchema,
  revokeSessionsSchema,
  suspendMemberSchema,
  type AddAdminNoteDto,
  type CloseMemberDto,
  type ReactivateMemberDto,
  type RequireReverificationDto,
  type RevokeSessionsDto,
  type SuspendMemberDto,
} from '../admin-member/admin-member.dto.js';
import {
  memberOpsListQuerySchema,
  memberOpsNotesListQuerySchema,
  type MemberOpsListQueryDto,
  type MemberOpsNotesListQueryDto,
} from './admin-member-ops.dto.js';
import { AdminMemberOpsService } from './admin-member-ops.service.js';
import {
  MemberOpsError,
  type MemberOpsActor,
} from './admin-member-ops.types.js';

/**
 * P7-S5A Member Operations adapter endpoints.
 *
 * Every route is market-scoped: the P7-S2 RbacGuard resolves the server-owned
 * Current Admin Market and rejects any client-supplied market disagreement.
 * The adapter then re-validates that the target member's current market IS the
 * selected market before delegating to the frozen Phase 2 owner commands.
 * No wallet/ledger projection is exposed on this surface.
 */
@ApiTags('Admin Member Operations')
@ApiBearerAuth()
@Controller('admin/member-ops/members')
@UseGuards(AuthGuard, RbacGuard)
export class AdminMemberOpsController {
  constructor(
    @Inject(AdminMemberOpsService)
    private readonly ops: AdminMemberOpsService,
  ) {}

  @Get()
  @RequirePermission('member.read')
  list(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(memberOpsListQuerySchema))
    filters: MemberOpsListQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.listMembers(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        filters,
      ),
    );
  }

  @Get(':publicMemberId')
  @RequirePermission('member.read')
  detail(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') publicMemberId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.getMember(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        publicMemberId,
      ),
    );
  }

  @Post(':publicMemberId/suspend')
  @RequirePermission('member.status.manage')
  @HttpCode(200)
  suspend(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') publicMemberId: string,
    @Body(new ZodValidationPipe(suspendMemberSchema)) input: SuspendMemberDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.suspendMember(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        publicMemberId,
        input,
      ),
    );
  }

  @Post(':publicMemberId/reactivate')
  @RequirePermission('member.status.manage')
  @HttpCode(200)
  reactivate(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') publicMemberId: string,
    @Body(new ZodValidationPipe(reactivateMemberSchema))
    input: ReactivateMemberDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.reactivateMember(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        publicMemberId,
        input,
      ),
    );
  }

  @Post(':publicMemberId/close')
  @RequirePermission('member.status.manage')
  @HttpCode(200)
  close(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') publicMemberId: string,
    @Body(new ZodValidationPipe(closeMemberSchema)) input: CloseMemberDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.closeMember(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        publicMemberId,
        input,
      ),
    );
  }

  @Post(':publicMemberId/revoke-sessions')
  @RequirePermission('member.session.revoke')
  @HttpCode(200)
  revokeSessions(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') publicMemberId: string,
    @Body(new ZodValidationPipe(revokeSessionsSchema))
    input: RevokeSessionsDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.revokeSessions(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        publicMemberId,
        input,
      ),
    );
  }

  @Post(':publicMemberId/require-reverification')
  @RequirePermission('member.reverification.require')
  @HttpCode(200)
  requireReverification(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') publicMemberId: string,
    @Body(new ZodValidationPipe(requireReverificationSchema))
    input: RequireReverificationDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.requireReverification(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        publicMemberId,
        input,
      ),
    );
  }

  @Post(':publicMemberId/notes')
  @RequirePermission('member.note.create')
  @HttpCode(200)
  addNote(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') publicMemberId: string,
    @Body(new ZodValidationPipe(addAdminNoteSchema)) input: AddAdminNoteDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.addAdminNote(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        publicMemberId,
        input,
      ),
    );
  }

  @Get(':publicMemberId/notes')
  @RequirePermission('member.note.read')
  getNotes(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') publicMemberId: string,
    @Query(new ZodValidationPipe(memberOpsNotesListQuerySchema))
    query: MemberOpsNotesListQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.ops.getMemberNotes(
        this.actor(actor, request, ip),
        this.currentMarket(request),
        publicMemberId,
        query,
      ),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private currentMarket(request: Request): string {
    const context = (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext;
    if (!context?.marketId) {
      // The RbacGuard normally guarantees this; fail closed if absent.
      throw new ForbiddenException({
        code: 'MARKET_SELECTION_REQUIRED',
        message: 'Select an authorized market to continue.',
      });
    }
    return context.marketId;
  }

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): MemberOpsActor {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      });
    }
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
    return {
      adminUserId: actor.adminUserId,
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MemberOpsError) {
        throw new ConflictException({
          code: 'MARKET_CONTEXT_MISMATCH',
          message: error.message,
          details: error.details,
        });
      }
      if (!(error instanceof AdminMemberError)) throw error;
      // Faithful re-map of the frozen owner error contract (the owner
      // controller applies the same mapping for its own routes).
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'ADMIN_MEMBER_NOT_FOUND':
          throw new NotFoundException(body);
        case 'ADMIN_MEMBER_MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        default:
          throw new ConflictException(body);
      }
    }
  }
}
