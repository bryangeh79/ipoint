import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  transactionConfirmSchema,
  type TransactionConfirmDto,
  transactionPreviewSchema,
  type TransactionPreviewDto,
} from './transaction.dto.js';
import { parseMerchantTransactionListQuery } from './transaction-read.dto.js';
import { TransactionReadService } from './transaction-read.service.js';
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
    @Inject(TransactionReadService)
    private readonly transactionReads: TransactionReadService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  list(
    @CurrentActor() actor: RequestActor | undefined,
    @Query() query: Record<string, unknown>,
  ) {
    this.assertMerchantActor(actor);
    return this.transactionReads.listMerchantTransactions(
      actor.accountId,
      parseMerchantTransactionListQuery(query),
    );
  }

  @Get(':transactionNumber')
  @UseGuards(AuthGuard)
  detail(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('transactionNumber') transactionNumber: string,
  ) {
    this.assertMerchantActor(actor);
    return this.transactionReads.getMerchantTransaction(
      actor.accountId,
      transactionNumber,
    );
  }

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

  @Post(':previewSessionId/confirm')
  @UseGuards(AuthGuard)
  confirm(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('previewSessionId', new ParseUUIDPipe()) previewSessionId: string,
    @Body(new ZodValidationPipe(transactionConfirmSchema))
    input: TransactionConfirmDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
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
        transactionErrorCodes.confirmIdempotencyRequired,
        'A valid Idempotency-Key header is required for confirmation.',
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
    return this.transactions.confirm(
      actor.accountId,
      previewSessionId,
      input,
      key,
      context,
    );
  }

  private assertMerchantActor(
    actor: RequestActor | undefined,
  ): asserts actor is RequestActor & { type: 'ACCOUNT' } {
    if (!actor || actor.type !== 'ACCOUNT') {
      transactionForbidden(
        transactionErrorCodes.receiptAccessDenied,
        'An authenticated merchant staff account is required.',
      );
    }
  }
}
