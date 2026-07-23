import {
  Body,
  Controller,
  Headers,
  Inject,
  Ip,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  transactionPreviewSchema,
  type TransactionPreviewDto,
} from './transaction.dto.js';
import {
  transactionBadRequest,
  transactionErrorCodes,
  transactionForbidden,
} from './transaction.errors.js';
import {
  TransactionService,
  type TransactionRequestContext,
} from './transaction.service.js';

@Controller('merchant/transactions')
export class TransactionController {
  constructor(
    @Inject(TransactionService)
    private readonly transactions: TransactionService,
  ) {}

  @Post('preview')
  @UseGuards(AuthGuard)
  preview(
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(transactionPreviewSchema))
    input: TransactionPreviewDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-market-id') marketContext: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    if (!actor || actor.type !== 'ACCOUNT') {
      transactionForbidden(
        transactionErrorCodes.merchantAccessDenied,
        'An authenticated merchant staff account is required.',
      );
    }
    const key = idempotencyKey?.trim();
    if (!key || key.length > 200) {
      transactionBadRequest(
        transactionErrorCodes.idempotencyRequired,
        'A valid Idempotency-Key header is required.',
      );
    }
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
    const context: TransactionRequestContext = {
      ipAddress,
      userAgent: request.headers['user-agent'],
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
    return this.transactions.createPreview(
      actor.accountId,
      input,
      key,
      marketContext?.trim() || undefined,
      context,
    );
  }
}
