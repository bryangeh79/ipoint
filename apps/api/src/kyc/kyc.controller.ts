import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Patch,
  PayloadTooLargeException,
  Post,
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
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  createDocumentSchema,
  createKycDraftSchema,
  resubmitKycSchema,
  submitKycSchema,
  updateKycDraftSchema,
  type CreateDocumentDto,
  type CreateKycDraftDto,
  type ResubmitKycDto,
  type SubmitKycDto,
  type UpdateKycDraftDto,
} from './kyc.dto.js';
import { KycService } from './kyc.service.js';
import { KycError, type MemberKycResponse } from './kyc.types.js';

@ApiTags('Members')
@Controller('members/me/kyc')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class KycController {
  constructor(@Inject(KycService) private readonly kyc: KycService) {}

  @Get()
  @ApiOperation({ summary: 'Get current member KYC status' })
  @ApiResponse({ status: 200, description: 'Current KYC case or NOT_STARTED.' })
  async getStatus(
    @CurrentActor() actor: RequestActor,
  ): Promise<MemberKycResponse> {
    return this.handle(actor, () => this.kyc.getStatus(actor.accountId));
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a member KYC Level 2 draft' })
  async createDraft(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createKycDraftSchema)) input: CreateKycDraftDto,
  ): Promise<MemberKycResponse> {
    return this.handle(actor, () =>
      this.kyc.createDraft(actor.accountId, input),
    );
  }

  @Patch()
  @ApiOperation({ summary: 'Update member KYC Level 2 draft fields' })
  async updateDraft(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(updateKycDraftSchema)) input: UpdateKycDraftDto,
  ): Promise<MemberKycResponse> {
    return this.handle(actor, () =>
      this.kyc.updateDraft(actor.accountId, input),
    );
  }

  @Post('documents')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add KYC document metadata to the draft' })
  async addDocument(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createDocumentSchema)) input: CreateDocumentDto,
  ): Promise<MemberKycResponse> {
    return this.handle(actor, () =>
      this.kyc.addDocument(actor.accountId, input),
    );
  }

  @Post('submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit the KYC Level 2 case for review' })
  async submit(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(submitKycSchema)) input: SubmitKycDto,
  ): Promise<MemberKycResponse> {
    return this.handle(actor, () => this.kyc.submit(actor.accountId, input));
  }

  @Post('resubmit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resubmit a KYC case after more information is requested',
  })
  async resubmit(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(resubmitKycSchema)) input: ResubmitKycDto,
  ): Promise<MemberKycResponse> {
    return this.handle(actor, () => this.kyc.resubmit(actor.accountId, input));
  }

  private async handle<T>(
    actor: RequestActor,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (actor.type !== 'ACCOUNT') {
      throw new BadRequestException({
        code: 'KYC_NOT_ALLOWED',
        message: 'Only member accounts can perform this action.',
      });
    }
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof KycError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'KYC_NOT_FOUND':
          throw new NotFoundException(body);
        case 'KYC_FILE_TOO_LARGE':
          throw new PayloadTooLargeException(body);
        case 'MEMBER_SUSPENDED':
        case 'MEMBER_CLOSED':
          throw new HttpException(body, HttpStatus.FORBIDDEN);
        case 'KYC_INVALID_STATE':
        case 'KYC_DOCUMENT_LIMIT_EXCEEDED':
        case 'KYC_DUPLICATE_DOCUMENT':
        case 'KYC_IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
        case 'KYC_MISSING_REQUIRED_FIELDS':
        case 'KYC_IDENTIFICATION_NUMBER_INVALID':
        case 'KYC_INVALID_FILE_TYPE':
          throw new BadRequestException(body);
        default:
          throw new HttpException(body, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
  }
}
