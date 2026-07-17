import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { updateProfileSchema } from './profile.dto.js';
import { ProfileService } from './profile.service.js';
import type { UpdateProfileDto } from './profile.dto.js';
import { ProfileError } from './profile.types.js';
import type { ProfileResponse } from './profile.types.js';

@ApiTags('Profile')
@Controller('members/me/profile')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class ProfileController {
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
    summary: 'Get member profile',
    description: 'Returns the profile of the currently authenticated member.',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile returned successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getProfile(
    @CurrentActor() actor: RequestActor,
  ): Promise<ProfileResponse> {
    return this.catchProfileError(async () =>
      this.profileService.getProfile(actor.accountId),
    );
  }

  @Patch()
  @ApiOperation({
    summary: 'Update member profile',
    description:
      'Updates one or more profile fields for the currently authenticated member.',
  })
  @ApiBody({ schema: { type: 'object' } })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully.',
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateProfile(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    return this.catchProfileError(async () =>
      this.profileService.updateProfile(actor.accountId, body, {}),
    );
  }
}
