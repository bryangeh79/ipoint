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
  transactionCorrectionRequestSchema,
  type TransactionCorrectionType,
} from './transaction-correction.dto.js';
import { TransactionCorrectionService } from './transaction-correction.service.js';
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
    @Inject(TransactionCorrectionService)
    private readonly transactionCorrections: TransactionCorrectionService,
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

  @Post(':transactionNumber/reversal-requests')
  @UseGuards(AuthGuard)
  requestReversal(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('transactionNumber') transactionNumber: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.requestCorrection(
      actor,
      transactionNumber,
      'REVERSAL',
      body,
      idempotencyKey,
      ipAddress,
      request,
    );
  }

  @Post(':transactionNumber/refund-requests')
  @UseGuards(AuthGuard)
  requestRefund(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('transactionNumber') transactionNumber: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.requestCorrection(
      actor,
      transactionNumber,
      'REFUND',
      body,
      idempotencyKey,
      ipAddress,
      request,
    );
  }

  @Get(':transactionNumber/reversal-request')
  @UseGuards(AuthGuard)
  getReversalRequest(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('transactionNumber') transactionNumber: string,
  ) {
    this.assertCorrectionActor(actor);
    return this.transactionCorrections.getCorrection(
      actor.accountId,
      transactionNumber,
      'REVERSAL',
    );
  }

  @Get(':transactionNumber/refund-request')
  @UseGuards(AuthGuard)
  getRefundRequest(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('transactionNumber') transactionNumber: string,
  ) {
    this.assertCorrectionActor(actor);
    return this.transactionCorrections.getCorrection(
      actor.accountId,
      transactionNumber,
      'REFUND',
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
    const requestId = this.requestId(request);
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
    const requestId = this.requestId(request);
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

  private requestCorrection(
    actor: RequestActor | undefined,
    transactionNumber: string,
    requestType: TransactionCorrectionType,
    body: unknown,
    idempotencyKey: string | undefined,
    ipAddress: string,
    request: Request,
  ) {
    this.assertCorrectionActor(actor);
    const parsed = transactionCorrectionRequestSchema.safeParse(body);
    if (!parsed.success) {
      transactionBadRequest(
        transactionErrorCodes.correctionReasonInvalid,
        'A valid reasonCode and optional reasonNote of at most 500 characters are required.',
      );
    }
    const key = idempotencyKey?.trim();
    if (!key || key.length > 200) {
      transactionBadRequest(
        transactionErrorCodes.correctionReasonInvalid,
        'A valid Idempotency-Key header is required.',
      );
    }
    const requestId = this.requestId(request);
    return this.transactionCorrections.requestCorrection(
      actor.accountId,
      transactionNumber,
      requestType,
      parsed.data,
      key,
      {
        ipAddress,
        ...(typeof requestId === 'string' ? { requestId } : {}),
      },
    );
  }

  private assertCorrectionActor(
    actor: RequestActor | undefined,
  ): asserts actor is RequestActor & { type: 'ACCOUNT' } {
    if (!actor || actor.type !== 'ACCOUNT') {
      transactionForbidden(
        transactionErrorCodes.correctionAccessDenied,
        'An authenticated Merchant Owner or Admin account is required.',
      );
    }
  }

  private requestId(request: Request): unknown {
    return (request as Request & { requestId?: unknown }).requestId;
  }
}
