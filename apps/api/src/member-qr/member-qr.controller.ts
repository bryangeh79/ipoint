/**
 * L-06 member QR controller - GET/POST/DELETE /members/me/qr.
 *
 * Canonical member guard pattern (AuthGuard + @CurrentActor + ACCOUNT
 * type check, mirroring member-self and KYC controllers) with a clean
 * contract-code 4xx mapping. Never exposes raw token material; the
 * display token returned by the service is the signed short-lived
 * payload, never a stored secret.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
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
import {
  revokeMemberQrSchema,
  rotateMemberQrSchema,
  type RevokeMemberQrDto,
  type RotateMemberQrDto,
} from './member-qr.dto.js';
import { MemberQrService } from './member-qr.service.js';
import {
  MemberQrError,
  type MemberQrRequestMetadata,
  type MemberQrResponse,
} from './member-qr.types.js';

@ApiTags('Members')
@Controller('members/me/qr')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class MemberQrController {
  constructor(
    @Inject(MemberQrService) private readonly memberQr: MemberQrService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'memberQrGet',
    summary: 'Get current member QR identity',
    description:
      'Returns the active member QR identity (public QR id, status, issued and expiry timestamps, signed short-lived display token) or a null QR state when the member has no QR identity yet. Never returns raw token material.',
  })
  @ApiResponse({
    status: 200,
    description: 'QR identity returned (qr may be null).',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'MEMBER_CLOSED.' })
  @ApiResponse({ status: 404, description: 'MEMBER_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'QR_REVOKED / STATE_CONFLICT.' })
  async getQr(
    @CurrentActor() actor: RequestActor,
    @Req() request: Request,
  ): Promise<MemberQrResponse> {
    this.assertMemberActor(actor);
    return this.mapError(() =>
      this.memberQr.getQr(actor.accountId, this.metadata(request)),
    );
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'memberQrRotate',
    summary: 'Issue or rotate the member QR identity',
    description:
      'Issues the first QR identity when none exists, or rotates the active one (the superseded identity is marked ROTATED and chained). Requires an Idempotency-Key header (or body idempotencyKey); replays return the stored response without creating rows.',
  })
  @ApiResponse({
    status: 200,
    description: 'QR identity issued or rotated.',
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'MEMBER_CLOSED.' })
  @ApiResponse({ status: 404, description: 'MEMBER_NOT_FOUND.' })
  @ApiResponse({
    status: 409,
    description:
      'QR_ACTIVE_EXISTS / QR_REVOKED / IDEMPOTENCY_CONFLICT / STATE_CONFLICT.',
  })
  async rotateQr(
    @CurrentActor() actor: RequestActor,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(rotateMemberQrSchema))
    input: RotateMemberQrDto,
    @Req() request: Request,
  ): Promise<MemberQrResponse> {
    this.assertMemberActor(actor);
    return this.mapError(() =>
      this.memberQr.rotateQr(
        actor.accountId,
        idempotencyKey ?? input.idempotencyKey,
        this.metadata(request),
      ),
    );
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    operationId: 'memberQrRevoke',
    summary: 'Revoke the member QR identity',
    description:
      'Revokes the active QR identity (status becomes REVOKED with revoked_at and reason). Requires an Idempotency-Key header (or body idempotencyKey); replays return 204 without changing state.',
  })
  @ApiResponse({ status: 204, description: 'QR identity revoked.' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'MEMBER_CLOSED.' })
  @ApiResponse({
    status: 404,
    description: 'QR_NOT_FOUND / MEMBER_NOT_FOUND.',
  })
  @ApiResponse({
    status: 409,
    description: 'QR_REVOKED / IDEMPOTENCY_CONFLICT / STATE_CONFLICT.',
  })
  async revokeQr(
    @CurrentActor() actor: RequestActor,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(revokeMemberQrSchema))
    input: RevokeMemberQrDto,
    @Req() request: Request,
  ): Promise<void> {
    this.assertMemberActor(actor);
    await this.mapError(() =>
      this.memberQr.revokeQr(
        actor.accountId,
        { reason: input.reason },
        idempotencyKey ?? input.idempotencyKey,
        this.metadata(request),
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private assertMemberActor(actor: RequestActor): void {
    if (actor.type !== 'ACCOUNT') {
      throw new BadRequestException({
        code: 'MEMBER_SELF_NOT_ALLOWED',
        message: 'Only member accounts can access this endpoint.',
      });
    }
  }

  private metadata(request: Request): MemberQrRequestMetadata {
    const record = request as unknown as Record<string, unknown>;
    return {
      requestId:
        typeof record['requestId'] === 'string'
          ? record['requestId']
          : undefined,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  private async mapError<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof MemberQrError)) throw error;
      const body = { code: error.code, message: error.message };
      switch (error.code) {
        case 'MEMBER_NOT_FOUND':
        case 'QR_NOT_FOUND':
          throw new NotFoundException(body);
        case 'MEMBER_CLOSED':
          throw new HttpException(body, HttpStatus.FORBIDDEN);
        case 'QR_REVOKED':
        case 'QR_ACTIVE_EXISTS':
        case 'STATE_CONFLICT':
        case 'IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
        case 'VALIDATION_ERROR':
          throw new BadRequestException(body);
        default:
          throw error;
      }
    }
  }
}
