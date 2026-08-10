import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ProfileService } from './profile.service.js';
import { ProfileError, type MemberSelfResponse } from './profile.types.js';

/**
 * Current-member self surface (GET /members/me).
 *
 * Added as the DEF-002 bounded fix: member-web's AuthProvider bootstrap
 * calls GET /members/me after login/refresh, but no such route existed
 * (only /members/me/profile, /members/me/kyc, /members/me/market, ...).
 * Follows the canonical member guard pattern (AuthGuard + CurrentActor +
 * member-account type check, mirroring the KYC controller), and maps
 * ProfileError to 400 (mirroring ProfileController.catchProfileError) so
 * an ACCOUNT session without a member row (e.g. merchant accounts) gets a
 * clean 4xx instead of an unhandled 500.
 */
@ApiTags('Members')
@Controller('members/me')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class MemberSelfController {
  private async catchProfileError<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ProfileError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }

  constructor(
    @Inject(ProfileService) private readonly profileService: ProfileService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get current member summary',
    description:
      'Returns the identity summary of the currently authenticated member (id, email, display name, phone, account country, KYC status, created at).',
  })
  @ApiResponse({
    status: 200,
    description: 'Current member summary returned.',
  })
  @ApiResponse({ status: 400, description: 'Not a member account.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getMe(
    @CurrentActor() actor: RequestActor,
  ): Promise<MemberSelfResponse> {
    if (actor.type !== 'ACCOUNT') {
      throw new BadRequestException({
        code: 'MEMBER_SELF_NOT_ALLOWED',
        message: 'Only member accounts can access this endpoint.',
      });
    }
    return this.catchProfileError(() =>
      this.profileService.getMemberSelf(actor.accountId),
    );
  }
}
