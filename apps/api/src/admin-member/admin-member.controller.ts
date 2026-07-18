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
import {
  addAdminNoteSchema,
  closeMemberSchema,
  memberListQuerySchema,
  reactivateMemberSchema,
  requireReverificationSchema,
  revokeSessionsSchema,
  suspendMemberSchema,
  type AddAdminNoteDto,
  type CloseMemberDto,
  type MemberListQueryDto,
  type ReactivateMemberDto,
  type RequireReverificationDto,
  type RevokeSessionsDto,
  type SuspendMemberDto,
} from './admin-member.dto.js';
import { AdminMemberService } from './admin-member.service.js';
import {
  AdminMemberError,
  type AdminMemberActor,
} from './admin-member.types.js';

@ApiTags('Admin Members')
@ApiBearerAuth()
@Controller('admin/members')
@UseGuards(AuthGuard, RbacGuard)
@RequirePermission('member.manage')
export class AdminMemberController {
  constructor(
    @Inject(AdminMemberService) private readonly members: AdminMemberService,
  ) {}

  @Get()
  list(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(memberListQuerySchema))
    filters: MemberListQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.members.listMembers(this.actor(actor, request, ip), filters),
    );
  }

  @Get(':publicMemberId')
  detail(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') publicMemberId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.members.getMember(this.actor(actor, request, ip), publicMemberId),
    );
  }

  @Post(':publicMemberId/suspend')
  @HttpCode(200)
  suspend(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') id: string,
    @Body(new ZodValidationPipe(suspendMemberSchema)) input: SuspendMemberDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.members.suspendMember(this.actor(actor, request, ip), id, input),
    );
  }

  @Post(':publicMemberId/reactivate')
  @HttpCode(200)
  reactivate(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') id: string,
    @Body(new ZodValidationPipe(reactivateMemberSchema))
    input: ReactivateMemberDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.members.reactivateMember(this.actor(actor, request, ip), id, input),
    );
  }

  @Post(':publicMemberId/close')
  @HttpCode(200)
  close(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') id: string,
    @Body(new ZodValidationPipe(closeMemberSchema)) input: CloseMemberDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.members.closeMember(this.actor(actor, request, ip), id, input),
    );
  }

  @Post(':publicMemberId/revoke-sessions')
  @HttpCode(200)
  revokeSessions(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') id: string,
    @Body(new ZodValidationPipe(revokeSessionsSchema)) input: RevokeSessionsDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.members.revokeSessions(this.actor(actor, request, ip), id, input),
    );
  }

  @Post(':publicMemberId/require-reverification')
  @HttpCode(200)
  requireReverification(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') id: string,
    @Body(new ZodValidationPipe(requireReverificationSchema))
    input: RequireReverificationDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.members.requireReverification(
        this.actor(actor, request, ip),
        id,
        input,
      ),
    );
  }

  @Post(':publicMemberId/notes')
  @HttpCode(200)
  addNote(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('publicMemberId') id: string,
    @Body(new ZodValidationPipe(addAdminNoteSchema)) input: AddAdminNoteDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.members.addAdminNote(this.actor(actor, request, ip), id, input),
    );
  }

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): AdminMemberActor {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'AUTH_PERMISSION_DENIED',
        message: 'An administrator session is required.',
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
      if (!(error instanceof AdminMemberError)) throw error;
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
