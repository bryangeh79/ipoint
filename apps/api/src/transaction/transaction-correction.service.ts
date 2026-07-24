import { createHash } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  correctionExecutions,
  correctionRequests,
  memberWalletAccounts,
  memberWalletEntries,
  rewardPlans,
  rewardSources,
  transactions,
} from '@ipoint/database';
import { Decimal } from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  TransactionCorrectionExecutionResponse,
  TransactionCorrectionRequestDto,
  TransactionCorrectionResponse,
  TransactionCorrectionType,
} from './transaction-correction.dto.js';
import {
  transactionConflict,
  transactionErrorCodes,
  transactionForbidden,
  transactionNotFound,
} from './transaction.errors.js';
import { TRANSACTION_EXECUTION_OPTIONS } from './transaction-reliability.js';

interface CorrectionTransactionRow {
  [key: string]: unknown;
  id: string;
  transactionNumber: string;
  status: string;
  merchantBranchId: string;
  marketId: string;
  accessType: string | null;
}

interface CorrectionReadRow {
  [key: string]: unknown;
  transactionNumber: string;
  requestType: TransactionCorrectionType;
  status: 'REQUESTED' | 'EXECUTED' | 'REJECTED';
  reasonCode: string;
  reasonNote: string | null;
  createdAt: Date | string;
  executedAt: Date | string | null;
  rejectedAt: Date | string | null;
}

interface ExecutionRow {
  [key: string]: unknown;
  requestId: string;
  requestType: TransactionCorrectionType;
  requestStatus: string;
  transactionId: string;
  transactionNumber: string;
  transactionStatus: string;
  merchantBranchId: string;
  marketId: string;
  memberId: string;
  marketTimezone: string;
  mcpAccountId: string;
  originalMcpEntryId: string;
  mcpAmount: string;
  rewardSourceId: string;
  rewardSourceConsumed: boolean;
  rewardPlanId: string;
  rewardPlanStatus: string;
}

interface McpPostingRow {
  [key: string]: unknown;
  entryId: string;
}

interface WalletCompensationRow {
  [key: string]: unknown;
  walletAccountId: string;
  originalEntryId: string;
  amount: string;
  pendingBalance: string;
  availableBalance: string;
}

const ALLOWED_CORRECTION_ROLES = new Set(['PRIMARY_OWNER', 'OWNER', 'ADMIN']);

@Injectable()
export class TransactionCorrectionService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async requestCorrection(
    accountId: string,
    transactionNumber: string,
    requestType: TransactionCorrectionType,
    input: TransactionCorrectionRequestDto,
    idempotencyKey: string,
    requestContext: { requestId?: string; ipAddress?: string } = {},
  ): Promise<TransactionCorrectionResponse> {
    this.assertTransactionNumber(transactionNumber);
    const keyHash = sha256(idempotencyKey);
    const payloadHash = sha256(
      canonicalJson({
        transactionNumber,
        requestType,
        reasonCode: input.reasonCode,
        reasonNote: input.reasonNote ?? null,
      }),
    );

    return this.database.runTransaction(async (tx) => {
      const transactionResult = await tx.execute<CorrectionTransactionRow>(sql`
        SELECT
          confirmed_transaction.id,
          confirmed_transaction.transaction_number::text AS "transactionNumber",
          confirmed_transaction.status::text AS status,
          confirmed_transaction.merchant_branch_id AS "merchantBranchId",
          confirmed_transaction.market_id AS "marketId",
          merchant_access.access_type::text AS "accessType"
        FROM transactions confirmed_transaction
        JOIN merchant_branches branch
          ON branch.id = confirmed_transaction.merchant_branch_id
        LEFT JOIN merchant_account_access merchant_access
          ON merchant_access.merchant_group_id = branch.merchant_group_id
         AND merchant_access.account_id = ${accountId}
        WHERE confirmed_transaction.transaction_number = ${transactionNumber}::bigint
        LIMIT 1
        FOR UPDATE OF confirmed_transaction
      `);
      const transaction = transactionResult.rows[0];
      if (
        !transaction ||
        !ALLOWED_CORRECTION_ROLES.has(transaction.accessType ?? '')
      ) {
        transactionForbidden(
          transactionErrorCodes.correctionAccessDenied,
          'Only a Merchant Owner or Admin may request a transaction correction.',
        );
      }

      const priorByKey = await tx
        .select({
          payloadHash: correctionRequests.payloadHash,
          response: correctionRequests.response,
        })
        .from(correctionRequests)
        .where(
          and(
            eq(
              correctionRequests.merchantBranchId,
              transaction.merchantBranchId,
            ),
            eq(correctionRequests.requestType, requestType),
            eq(correctionRequests.keyHash, keyHash),
          ),
        )
        .limit(1);
      const replay = priorByKey[0];
      if (replay) {
        if (replay.payloadHash !== payloadHash) {
          transactionConflict(
            transactionErrorCodes.correctionConflict,
            'The Idempotency-Key was already used with a different correction payload.',
          );
        }
        return replay.response as TransactionCorrectionResponse;
      }

      if (
        transaction.status === 'REVERSED' ||
        transaction.status === 'REFUNDED' ||
        transaction.status === 'REJECTED' ||
        transaction.status === 'FAILED' ||
        transaction.status === 'EXPIRED'
      ) {
        transactionConflict(
          requestType === 'REVERSAL'
            ? transactionErrorCodes.reversalNotAllowed
            : transactionErrorCodes.refundNotAllowed,
          `A ${requestType.toLowerCase()} is not allowed for this transaction state.`,
        );
      }

      const existingRequests = await tx
        .select({
          requestType: correctionRequests.requestType,
          status: correctionRequests.status,
        })
        .from(correctionRequests)
        .where(eq(correctionRequests.transactionId, transaction.id));
      const opposite = existingRequests.find(
        (request) => request.requestType !== requestType,
      );
      if (opposite) {
        transactionConflict(
          transactionErrorCodes.correctionConflict,
          `A ${opposite.requestType.toLowerCase()} request already exists for this transaction.`,
        );
      }
      if (
        existingRequests.some((request) => request.requestType === requestType)
      ) {
        transactionConflict(
          requestType === 'REVERSAL'
            ? transactionErrorCodes.reversalAlreadyRequested
            : transactionErrorCodes.refundAlreadyRequested,
          `A ${requestType.toLowerCase()} request already exists for this transaction.`,
        );
      }
      if (transaction.status !== 'CONFIRMED') {
        transactionConflict(
          requestType === 'REVERSAL'
            ? transactionErrorCodes.reversalNotAllowed
            : transactionErrorCodes.refundNotAllowed,
          `A ${requestType.toLowerCase()} may only be requested for a confirmed transaction.`,
        );
      }

      const now = new Date();
      const response: TransactionCorrectionResponse = {
        transactionNumber: transaction.transactionNumber,
        requestType,
        status: 'REQUESTED',
        reasonCode: input.reasonCode,
        reasonNote: input.reasonNote ?? null,
        requestedAt: now.toISOString(),
        executedAt: null,
        rejectedAt: null,
      };
      const inserted = await tx
        .insert(correctionRequests)
        .values({
          transactionId: transaction.id,
          merchantBranchId: transaction.merchantBranchId,
          marketId: transaction.marketId,
          requestType,
          status: 'REQUESTED',
          reasonCode: input.reasonCode,
          reasonNote: input.reasonNote ?? null,
          requestedByAccountId: accountId,
          keyHash,
          payloadHash,
          response,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: correctionRequests.id });
      const requestId = inserted[0]?.id;
      if (!requestId) {
        transactionConflict(
          transactionErrorCodes.correctionConflict,
          'The correction request could not be created.',
        );
      }

      await tx
        .update(transactions)
        .set({
          status:
            requestType === 'REVERSAL'
              ? 'REVERSAL_REQUESTED'
              : 'REFUND_REQUESTED',
        })
        .where(eq(transactions.id, transaction.id));

      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ACCOUNT', id: accountId },
        action:
          requestType === 'REVERSAL'
            ? 'TRANSACTION_REVERSAL_REQUESTED'
            : 'TRANSACTION_REFUND_REQUESTED',
        entity: { type: 'transaction_correction', id: requestId },
        marketId: transaction.marketId,
        after: {
          transactionNumber: transaction.transactionNumber,
          requestType,
          reasonCode: input.reasonCode,
          reasonNote: input.reasonNote ?? null,
        },
        reason: input.reasonCode,
        result: 'SUCCESS',
        requestId: requestContext.requestId,
        ipAddress: requestContext.ipAddress,
        summary: `${requestType} requested for transaction ${transaction.transactionNumber}.`,
      });

      return response;
    }, TRANSACTION_EXECUTION_OPTIONS);
  }

  async getCorrection(
    accountId: string,
    transactionNumber: string,
    requestType: TransactionCorrectionType,
  ): Promise<TransactionCorrectionResponse> {
    this.assertTransactionNumber(transactionNumber);
    const result = await this.database.pool.query<CorrectionReadRow>(
      `
        SELECT
          confirmed_transaction.transaction_number::text AS "transactionNumber",
          correction.request_type::text AS "requestType",
          correction.status::text AS status,
          correction.reason_code AS "reasonCode",
          correction.reason_note AS "reasonNote",
          correction.created_at AS "createdAt",
          correction.executed_at AS "executedAt",
          correction.rejected_at AS "rejectedAt"
        FROM correction_requests correction
        JOIN transactions confirmed_transaction
          ON confirmed_transaction.id = correction.transaction_id
        JOIN merchant_branches branch
          ON branch.id = correction.merchant_branch_id
        JOIN merchant_account_access merchant_access
          ON merchant_access.merchant_group_id = branch.merchant_group_id
         AND merchant_access.account_id = $1::uuid
         AND merchant_access.access_type::text IN ('PRIMARY_OWNER', 'OWNER', 'ADMIN')
        WHERE confirmed_transaction.transaction_number = $2::bigint
          AND correction.request_type::text = $3
        LIMIT 1
      `,
      [accountId, transactionNumber, requestType],
    );
    const row = result.rows[0];
    if (!row) {
      transactionNotFound(
        transactionErrorCodes.correctionNotFound,
        'The correction request was not found.',
      );
    }
    return {
      transactionNumber: row.transactionNumber,
      requestType: row.requestType,
      status: row.status,
      reasonCode: row.reasonCode,
      reasonNote: row.reasonNote,
      requestedAt: new Date(row.createdAt).toISOString(),
      executedAt: row.executedAt
        ? new Date(row.executedAt).toISOString()
        : null,
      rejectedAt: row.rejectedAt
        ? new Date(row.rejectedAt).toISOString()
        : null,
    };
  }

  /**
   * Internal execution boundary. Deliberately not exposed by a controller in P4-S6.
   */
  async executeCorrection(
    correctionRequestId: string,
    executionKey: string,
  ): Promise<TransactionCorrectionExecutionResponse> {
    const executionKeyHash = sha256(executionKey);
    const payloadHash = sha256(canonicalJson({ correctionRequestId }));
    try {
      return await this.database.runTransaction(async (tx) => {
        // Global transaction-engine lock order:
        // advisory operation key -> transaction/correction -> MCP -> wallet.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${'transaction-correction:' + correctionRequestId}, 0)
          )
        `);
        const executionResult = await tx.execute<ExecutionRow>(sql`
          SELECT
            correction.id AS "requestId",
            correction.request_type::text AS "requestType",
            correction.status::text AS "requestStatus",
            confirmed_transaction.id AS "transactionId",
            confirmed_transaction.transaction_number::text AS "transactionNumber",
            confirmed_transaction.status::text AS "transactionStatus",
            confirmed_transaction.merchant_branch_id AS "merchantBranchId",
            confirmed_transaction.market_id AS "marketId",
            confirmed_transaction.member_id AS "memberId",
            confirmed_transaction.market_timezone AS "marketTimezone",
            mcp_debit.mcp_account_id AS "mcpAccountId",
            mcp_debit.mcp_ledger_entry_id AS "originalMcpEntryId",
            mcp_debit.amount AS "mcpAmount",
            reward_link.reward_source_id AS "rewardSourceId",
            reward_source.consumed AS "rewardSourceConsumed",
            reward_link.reward_plan_id AS "rewardPlanId",
            reward_plan.status::text AS "rewardPlanStatus"
          FROM correction_requests correction
          JOIN transactions confirmed_transaction
            ON confirmed_transaction.id = correction.transaction_id
          JOIN transaction_mcp_debits mcp_debit
            ON mcp_debit.transaction_id = confirmed_transaction.id
          JOIN transaction_reward_links reward_link
            ON reward_link.transaction_id = confirmed_transaction.id
          JOIN reward_sources reward_source
            ON reward_source.id = reward_link.reward_source_id
          JOIN reward_plans reward_plan
            ON reward_plan.id = reward_link.reward_plan_id
          WHERE correction.id = ${correctionRequestId}
          FOR UPDATE OF correction, confirmed_transaction, reward_source, reward_plan
        `);
        const correction = executionResult.rows[0];
        if (!correction) {
          transactionNotFound(
            transactionErrorCodes.correctionNotFound,
            'The correction request was not found.',
          );
        }

        const priorExecutions = await tx
          .select({
            executionKeyHash: correctionExecutions.executionKeyHash,
            payloadHash: correctionExecutions.payloadHash,
            response: correctionExecutions.response,
          })
          .from(correctionExecutions)
          .where(
            eq(correctionExecutions.correctionRequestId, correctionRequestId),
          )
          .limit(1);
        const prior = priorExecutions[0];
        if (prior) {
          if (
            prior.executionKeyHash !== executionKeyHash ||
            prior.payloadHash !== payloadHash
          ) {
            transactionConflict(
              transactionErrorCodes.correctionConflict,
              'The correction execution key or payload does not match the completed execution.',
            );
          }
          return prior.response as TransactionCorrectionExecutionResponse;
        }

        const requestedTransactionStatus =
          correction.requestType === 'REVERSAL'
            ? 'REVERSAL_REQUESTED'
            : 'REFUND_REQUESTED';
        if (
          correction.requestStatus !== 'REQUESTED' ||
          correction.transactionStatus !== requestedTransactionStatus
        ) {
          transactionConflict(
            transactionErrorCodes.correctionExecutionFailed,
            'The correction request is not executable.',
          );
        }
        if (
          !correction.rewardSourceConsumed ||
          correction.rewardPlanStatus === 'REVERSED'
        ) {
          transactionConflict(
            transactionErrorCodes.correctionExecutionFailed,
            'The reward entitlement is already compensated or is inconsistent.',
          );
        }

        const now = new Date();
        const mcpPayloadHash = sha256(
          canonicalJson({
            correctionRequestId,
            transactionId: correction.transactionId,
            originalMcpEntryId: correction.originalMcpEntryId,
            amount: correction.mcpAmount,
          }),
        );
        const mcpPostingResult = await tx.execute<McpPostingRow>(sql`
          SELECT entry_id AS "entryId"
          FROM append_mcp_ledger_entry(
            ${correction.mcpAccountId}::uuid,
            ${correction.requestType === 'REVERSAL' ? 'REVERSAL' : 'REFUND'}::mcp_entry_type,
            'CREDIT'::mcp_direction,
            ${correction.mcpAmount}::numeric,
            ${correction.mcpAmount}::numeric,
            ${correction.mcpAmount}::numeric,
            'TRANSACTION_CORRECTION',
            ${correctionRequestId},
            ${`transaction:correction:mcp:${correctionRequestId}`},
            ${mcpPayloadHash},
            'SYSTEM',
            NULL,
            ${`TRANSACTION_${correction.requestType}`},
            ${now},
            ${correction.originalMcpEntryId}::uuid,
            ${JSON.stringify({
              transactionId: correction.transactionId,
              requestType: correction.requestType,
            })}::jsonb
          )
        `);
        const mcpLedgerEntryId = mcpPostingResult.rows[0]?.entryId;
        if (!mcpLedgerEntryId) {
          throw new Error('The compensating MCP ledger entry was not created.');
        }

        await tx
          .update(rewardSources)
          .set({ consumed: false })
          .where(eq(rewardSources.id, correction.rewardSourceId));
        await tx
          .update(rewardPlans)
          .set({ status: 'REVERSED', reversedAt: now, updatedAt: now })
          .where(eq(rewardPlans.id, correction.rewardPlanId));

        const walletLedgerEntryId = await this.compensateWallet(
          tx,
          correction,
          now,
        );
        const finalStatus =
          correction.requestType === 'REVERSAL' ? 'REVERSED' : 'REFUNDED';
        const response: TransactionCorrectionExecutionResponse = {
          transactionNumber: correction.transactionNumber,
          requestType: correction.requestType,
          status: finalStatus,
          executedAt: now.toISOString(),
        };

        await tx.insert(correctionExecutions).values({
          correctionRequestId,
          transactionId: correction.transactionId,
          executionKeyHash,
          payloadHash,
          mcpLedgerEntryId,
          walletLedgerEntryId,
          rewardSourceId: correction.rewardSourceId,
          rewardPlanId: correction.rewardPlanId,
          response,
          createdAt: now,
        });
        await tx
          .update(correctionRequests)
          .set({ status: 'EXECUTED', executedAt: now, updatedAt: now })
          .where(eq(correctionRequests.id, correctionRequestId));
        await tx
          .update(transactions)
          .set({ status: finalStatus })
          .where(eq(transactions.id, correction.transactionId));

        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'SYSTEM' },
          action:
            correction.requestType === 'REVERSAL'
              ? 'TRANSACTION_REVERSED'
              : 'TRANSACTION_REFUNDED',
          entity: { type: 'transaction_correction', id: correctionRequestId },
          marketId: correction.marketId,
          before: { status: requestedTransactionStatus },
          after: {
            status: finalStatus,
            transactionNumber: correction.transactionNumber,
            mcpCompensated: true,
            rewardCompensated: true,
            walletCompensated: walletLedgerEntryId !== null,
          },
          result: 'SUCCESS',
          summary: `${correction.requestType} executed for transaction ${correction.transactionNumber}.`,
        });

        return response;
      }, TRANSACTION_EXECUTION_OPTIONS);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      transactionConflict(
        transactionErrorCodes.correctionExecutionFailed,
        'The correction execution failed and no compensating state was committed.',
      );
    }
  }

  private async compensateWallet(
    tx: Parameters<Parameters<typeof this.database.db.transaction>[0]>[0],
    correction: ExecutionRow,
    now: Date,
  ): Promise<string | null> {
    const walletResult = await tx.execute<WalletCompensationRow>(sql`
      SELECT
        wallet.id AS "walletAccountId",
        original_entry.id AS "originalEntryId",
        original_entry.amount,
        wallet.pending_balance AS "pendingBalance",
        wallet.available_balance AS "availableBalance"
      FROM member_wallet_entries original_entry
      JOIN member_wallet_accounts wallet
        ON wallet.id = original_entry.wallet_account_id
      WHERE original_entry.reference_type = 'TRANSACTION'
        AND original_entry.reference_id = ${correction.transactionId}
        AND original_entry.idempotency_key = ${`reward:tx:${correction.transactionId}`}
      LIMIT 1
      FOR UPDATE OF wallet
    `);
    const wallet = walletResult.rows[0];
    if (!wallet) return null;

    const amount = new Decimal(wallet.amount);
    const pending = new Decimal(wallet.pendingBalance);
    const available = new Decimal(wallet.availableBalance);
    let balanceBefore: string;
    let balanceAfter: string;
    let walletUpdate: {
      pendingBalance?: string;
      availableBalance?: string;
      reversedBalance: ReturnType<typeof sql>;
      version: ReturnType<typeof sql>;
      updatedAt: Date;
    };
    if (pending.greaterThanOrEqualTo(amount)) {
      balanceBefore = pending.toFixed(10);
      balanceAfter = pending.minus(amount).toFixed(10);
      walletUpdate = {
        pendingBalance: balanceAfter,
        reversedBalance: sql`${memberWalletAccounts.reversedBalance} + ${amount.toFixed(10)}::numeric`,
        version: sql`${memberWalletAccounts.version} + 1`,
        updatedAt: now,
      };
    } else if (available.greaterThanOrEqualTo(amount)) {
      balanceBefore = available.toFixed(10);
      balanceAfter = available.minus(amount).toFixed(10);
      walletUpdate = {
        availableBalance: balanceAfter,
        reversedBalance: sql`${memberWalletAccounts.reversedBalance} + ${amount.toFixed(10)}::numeric`,
        version: sql`${memberWalletAccounts.version} + 1`,
        updatedAt: now,
      };
    } else {
      throw new Error('The member wallet cannot fund the compensating entry.');
    }

    const sequence = await tx.execute<{ nextSequence: string }>(sql`
      SELECT (COALESCE(MAX(entry_sequence), 0) + 1)::text AS "nextSequence"
      FROM member_wallet_entries
      WHERE wallet_account_id = ${wallet.walletAccountId}
    `);
    await tx
      .update(memberWalletAccounts)
      .set(walletUpdate)
      .where(eq(memberWalletAccounts.id, wallet.walletAccountId));
    const inserted = await tx
      .insert(memberWalletEntries)
      .values({
        walletAccountId: wallet.walletAccountId,
        memberId: correction.memberId,
        marketId: correction.marketId,
        entrySequence: BigInt(sequence.rows[0]?.nextSequence ?? '1'),
        entryType: 'COMPENSATION',
        amount: amount.toFixed(10),
        balanceBefore,
        balanceAfter,
        idempotencyKey: `transaction:correction:wallet:${correction.requestId}`,
        referenceType: 'TRANSACTION_CORRECTION',
        referenceId: correction.requestId,
        description: `${correction.requestType} compensation for transaction ${correction.transactionNumber}`,
        reason: `TRANSACTION_${correction.requestType}`,
        actorId: 'SYSTEM',
        marketTimezone: correction.marketTimezone,
        createdAt: now,
      })
      .returning({ id: memberWalletEntries.id });
    const walletEntryId = inserted[0]?.id;
    if (!walletEntryId) {
      throw new Error('The compensating wallet ledger entry was not created.');
    }
    return walletEntryId;
  }

  private assertTransactionNumber(transactionNumber: string): void {
    if (
      transactionNumber.length > 30 ||
      !/^[1-9]\d*$/u.test(transactionNumber)
    ) {
      transactionNotFound(
        transactionErrorCodes.correctionNotFound,
        'The correction request was not found.',
      );
    }
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
