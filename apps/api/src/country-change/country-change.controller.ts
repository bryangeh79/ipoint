import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import type { CountryChangeRequestResponse } from './country-change.types.js';
import { CountryChangeError } from './country-change.errors.js';
import { CountryChangeService } from './country-change.service.js';
import {
  submitCountryChangeSchema,
  type SubmitCountryChangeDto,
} from './country-change.dto.js';

// ---------------------------------------------------------------------------
// OpenAPI schema fragments
// ---------------------------------------------------------------------------

const countryChangeResponseSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string', format: 'uuid', description: 'Request ID' },
    currentCountry: {
      type: 'string',
      description: 'Current account country (ISO 3166-1 alpha-2)',
    },
    requestedCountry: {
      type: 'string',
      description: 'Requested country (ISO 3166-1 alpha-2)',
    },
    status: {
      type: 'string',
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      description: 'Request status',
    },
    reason: { type: 'string', description: 'Member reason for change' },
    submittedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Submission timestamp (ISO 8601 UTC)',
    },
    reviewedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'Review timestamp (ISO 8601 UTC)',
    },
    reviewedBy: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      description: 'Admin user who reviewed the request',
    },
    reviewReason: {
      type: 'string',
      nullable: true,
      description: 'Review notes from admin',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'Record creation timestamp (ISO 8601 UTC)',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Last update timestamp (ISO 8601 UTC)',
    },
  },
};

const countryChangeListResponseSchema = {
  type: 'array' as const,
  items: countryChangeResponseSchema,
};

const submitBodySchema = {
  type: 'object' as const,
  properties: {
    requested_country: {
      type: 'string',
      pattern: '^[A-Z]{2}$',
      description: 'Target country (ISO 3166-1 alpha-2)',
    },
    reason: {
      type: 'string',
      minLength: 1,
      maxLength: 2000,
      description: 'Reason for country change request',
    },
  },
  required: ['requested_country', 'reason'],
};

const errorBodySchema = {
  type: 'object' as const,
  properties: {
    error: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'Machine-readable error code' },
        message: { type: 'string', description: 'Human-readable description' },
      },
    },
    requestId: {
      type: 'string',
      format: 'uuid',
      description: 'Correlation ID',
    },
  },
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('Members')
@Controller('members/me/account-country-change')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class CountryChangeController {
  constructor(
    @Inject(CountryChangeService)
    private readonly countryChange: CountryChangeService,
  ) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({
    summary: 'View pending/cancelled country change requests',
    description:
      'Returns all pending and cancelled country change requests for the authenticated member, ordered by most recent first.',
  })
  @ApiOkResponse({
    description:
      'List of pending/cancelled country change requests (may be empty)',
    schema: countryChangeListResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required (AUTH_SESSION_INVALID)',
    schema: errorBodySchema,
  })
  async list(
    @CurrentActor() actor: RequestActor,
  ): Promise<CountryChangeRequestResponse[]> {
    if (actor.type !== 'ACCOUNT') {
      throw new BadRequestException({
        code: 'COUNTRY_CHANGE_NOT_ALLOWED',
        message: 'Only member accounts can perform this action.',
      });
    }
    return this.handleAsync(() =>
      this.countryChange.findRequests(actor.accountId),
    );
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Submit a country change request',
    description:
      'Creates a new country change request for the authenticated member. The request will be reviewed by an admin. Only one pending request per member is allowed at a time.',
  })
  @ApiBody({
    description: 'Country change request parameters',
    schema: submitBodySchema,
  })
  @ApiOkResponse({
    description: 'Country change request created successfully',
    schema: countryChangeResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'Validation failure (VALIDATION_ERROR) or same country (COUNTRY_CHANGE_COUNTRY_SAME)',
    schema: errorBodySchema,
  })
  @ApiConflictResponse({
    description:
      'A pending request already exists (COUNTRY_CHANGE_ALREADY_PENDING)',
    schema: errorBodySchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required (AUTH_SESSION_INVALID)',
    schema: errorBodySchema,
  })
  async submit(
    @Body(new ZodValidationPipe(submitCountryChangeSchema))
    input: SubmitCountryChangeDto,
    @CurrentActor() actor: RequestActor,
  ): Promise<CountryChangeRequestResponse> {
    if (actor.type !== 'ACCOUNT') {
      throw new BadRequestException({
        code: 'COUNTRY_CHANGE_NOT_ALLOWED',
        message: 'Only member accounts can perform this action.',
      });
    }
    return this.handleAsync(() =>
      this.countryChange.submit(
        actor.accountId,
        input.requested_country,
        input.reason,
      ),
    );
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel pending country change request',
    description:
      'Cancels the pending country change request for the authenticated member. Only PENDING requests can be cancelled. Requests that are APPROVED or REJECTED cannot be cancelled.',
  })
  @ApiOkResponse({
    description: 'Country change request cancelled successfully',
    schema: countryChangeResponseSchema,
  })
  @ApiNotFoundResponse({
    description: 'No pending request found (COUNTRY_CHANGE_NOT_FOUND)',
    schema: errorBodySchema,
  })
  @ApiBadRequestResponse({
    description:
      'Cannot cancel non-pending request (COUNTRY_CHANGE_CANCEL_NOT_ALLOWED)',
    schema: errorBodySchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required (AUTH_SESSION_INVALID)',
    schema: errorBodySchema,
  })
  async cancel(
    @CurrentActor() actor: RequestActor,
  ): Promise<CountryChangeRequestResponse> {
    if (actor.type !== 'ACCOUNT') {
      throw new BadRequestException({
        code: 'COUNTRY_CHANGE_NOT_ALLOWED',
        message: 'Only member accounts can perform this action.',
      });
    }
    return this.handleAsync(() => this.countryChange.cancel(actor.accountId));
  }

  private async handleAsync<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof CountryChangeError)) throw error;
      switch (error.code) {
        case 'COUNTRY_CHANGE_ALREADY_PENDING': {
          throw new ConflictException({
            code: error.code,
            message: error.message,
          });
        }
        case 'COUNTRY_CHANGE_NOT_FOUND': {
          throw new NotFoundException({
            code: error.code,
            message: error.message,
          });
        }
        case 'COUNTRY_CHANGE_COUNTRY_SAME':
        case 'COUNTRY_CHANGE_CANCEL_NOT_ALLOWED':
        case 'COUNTRY_CHANGE_MEMBER_NOT_FOUND':
        case 'COUNTRY_CHANGE_INVALID_COUNTRY': {
          throw new BadRequestException({
            code: error.code,
            message: error.message,
          });
        }
        default: {
          throw new HttpException(
            { code: error.code, message: error.message },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }
    }
  }
}
