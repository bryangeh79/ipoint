import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { parseMemberTransactionListQuery } from './transaction-read.dto.js';
import { TransactionReadService } from './transaction-read.service.js';
import {
  transactionErrorCodes,
  transactionForbidden,
} from './transaction.errors.js';

@Controller('members/me/transactions')
@UseGuards(AuthGuard)
export class MemberTransactionController {
  constructor(
    @Inject(TransactionReadService)
    private readonly transactions: TransactionReadService,
  ) {}

  @Get()
  list(
    @CurrentActor() actor: RequestActor | undefined,
    @Query() query: Record<string, unknown>,
  ) {
    this.assertAccountActor(actor);
    return this.transactions.listMemberTransactions(
      actor.accountId,
      parseMemberTransactionListQuery(query),
    );
  }

  @Get(':transactionNumber')
  detail(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('transactionNumber') transactionNumber: string,
  ) {
    this.assertAccountActor(actor);
    return this.transactions.getMemberTransaction(
      actor.accountId,
      transactionNumber,
    );
  }

  private assertAccountActor(
    actor: RequestActor | undefined,
  ): asserts actor is RequestActor & { type: 'ACCOUNT' } {
    if (!actor || actor.type !== 'ACCOUNT') {
      transactionForbidden(
        transactionErrorCodes.receiptAccessDenied,
        'An authenticated member account is required.',
      );
    }
  }
}
