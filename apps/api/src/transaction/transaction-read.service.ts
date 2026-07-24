import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import type {
  MemberTransactionListQuery,
  MerchantTransactionListQuery,
  MerchantTransactionReadModel,
  TransactionListResponse,
  TransactionReadReceiptData,
} from './transaction-read.dto.js';
import {
  transactionBadRequest,
  transactionErrorCodes,
  transactionForbidden,
  transactionNotFound,
} from './transaction.errors.js';

interface MerchantBranchAccessRow extends QueryResultRow {
  branchId: string;
}

interface MemberIdentityRow extends QueryResultRow {
  memberId: string;
}

interface TransactionReadRow extends QueryResultRow {
  transactionNumber: string;
  status: 'CONFIRMED';
  publicMerchantId: string;
  merchantName: string;
  branchName: string;
  protectedMemberReference: string;
  memberDisplayName: string | null;
  marketCode: string;
  currency: string;
  purchaseAmount: string;
  packageName: string | null;
  serviceFeeRate: string;
  serviceFeeAmount: string;
  rewardRate: string;
  dailyRewardAmount: string;
  rewardCap: string;
  rewardStartBusinessDate: string;
  merchantReceiptNumber: string | null;
  transactionNote: string | null;
  transactionTime: Date | string;
  mcpDeducted?: string;
  mcpBalanceAfter?: string;
}

interface CursorPayload {
  transactionTime: string;
  transactionNumber: string;
}

@Injectable()
export class TransactionReadService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async listMerchantTransactions(
    accountId: string,
    query: MerchantTransactionListQuery,
  ): Promise<TransactionListResponse<MerchantTransactionReadModel>> {
    const accessibleBranchIds =
      await this.resolveMerchantBranchAccess(accountId);
    if (accessibleBranchIds.length === 0) {
      this.denyReceiptAccess();
    }
    if (query.branchId && !accessibleBranchIds.includes(query.branchId)) {
      transactionForbidden(
        transactionErrorCodes.merchantAccessDenied,
        'The requested merchant branch is not authorized.',
      );
    }
    const branchIds = query.branchId ? [query.branchId] : accessibleBranchIds;
    const cursor = this.decodeCursor(query.cursor);
    const queryResult = await this.database.pool.query<TransactionReadRow>(
      `
        SELECT
          transaction.transaction_number::text AS "transactionNumber",
          transaction.status::text AS status,
          branch.merchant_id AS "publicMerchantId",
          merchant_group.name AS "merchantName",
          branch.name AS "branchName",
          transaction.protected_member_reference AS "protectedMemberReference",
          member_profile.display_name AS "memberDisplayName",
          market.code AS "marketCode",
          transaction.currency,
          transaction.purchase_amount::text AS "purchaseAmount",
          transaction.merchant_package_snapshot->>'name' AS "packageName",
          fee.rate::text AS "serviceFeeRate",
          fee.amount::text AS "serviceFeeAmount",
          transaction.reward_rate::text AS "rewardRate",
          transaction.daily_reward_amount::text AS "dailyRewardAmount",
          transaction.reward_cap::text AS "rewardCap",
          transaction.reward_start_business_date::text AS "rewardStartBusinessDate",
          transaction.merchant_receipt_number AS "merchantReceiptNumber",
          transaction.transaction_note AS "transactionNote",
          transaction.confirmed_at AS "transactionTime",
          debit.amount::text AS "mcpDeducted",
          debit.balance_after::text AS "mcpBalanceAfter"
        FROM transactions transaction
        JOIN merchant_branches branch
          ON branch.id = transaction.merchant_branch_id
        JOIN merchant_groups merchant_group
          ON merchant_group.id = branch.merchant_group_id
        JOIN markets market ON market.id = transaction.market_id
        LEFT JOIN member_profiles member_profile
          ON member_profile.member_id = transaction.member_id
        JOIN transaction_service_fees fee
          ON fee.transaction_id = transaction.id
        JOIN transaction_mcp_debits debit
          ON debit.transaction_id = transaction.id
        WHERE transaction.merchant_branch_id = ANY($1::uuid[])
          AND ($2::transaction_status IS NULL OR transaction.status = $2)
          AND ($3::text IS NULL OR market.code = $3)
          AND ($4::timestamptz IS NULL OR transaction.confirmed_at >= $4)
          AND ($5::timestamptz IS NULL OR transaction.confirmed_at <= $5)
          AND ($6::text IS NULL OR transaction.merchant_receipt_number = $6)
          AND ($7::bigint IS NULL OR transaction.transaction_number = $7)
          AND (
            $8::timestamptz IS NULL
            OR transaction.confirmed_at < $8
            OR (
              transaction.confirmed_at = $8
              AND transaction.transaction_number < $9::bigint
            )
          )
        ORDER BY transaction.confirmed_at DESC, transaction.transaction_number DESC
        LIMIT $10
      `,
      [
        branchIds,
        query.status ?? null,
        query.marketCode ?? null,
        query.dateFrom ?? null,
        query.dateTo ?? null,
        query.merchantReceiptNumber ?? null,
        query.transactionNumber ?? null,
        cursor?.transactionTime ?? null,
        cursor?.transactionNumber ?? null,
        query.limit + 1,
      ],
    );
    const rows = (queryResult).rows;
    return this.toMerchantList(rows, query.limit);
  }

  async getMerchantTransaction(
    accountId: string,
    transactionNumber: string,
  ): Promise<MerchantTransactionReadModel> {
    if (!isTransactionNumber(transactionNumber)) {
      this.receiptNotFound();
    }
    const branchIds = await this.resolveMerchantBranchAccess(accountId);
    if (branchIds.length === 0) {
      this.denyReceiptAccess();
    }
    const queryResult = await this.database.pool.query<TransactionReadRow>(
      `
        SELECT
          transaction.transaction_number::text AS "transactionNumber",
          transaction.status::text AS status,
          branch.merchant_id AS "publicMerchantId",
          merchant_group.name AS "merchantName",
          branch.name AS "branchName",
          transaction.protected_member_reference AS "protectedMemberReference",
          member_profile.display_name AS "memberDisplayName",
          market.code AS "marketCode",
          transaction.currency,
          transaction.purchase_amount::text AS "purchaseAmount",
          transaction.merchant_package_snapshot->>'name' AS "packageName",
          fee.rate::text AS "serviceFeeRate",
          fee.amount::text AS "serviceFeeAmount",
          transaction.reward_rate::text AS "rewardRate",
          transaction.daily_reward_amount::text AS "dailyRewardAmount",
          transaction.reward_cap::text AS "rewardCap",
          transaction.reward_start_business_date::text AS "rewardStartBusinessDate",
          transaction.merchant_receipt_number AS "merchantReceiptNumber",
          transaction.transaction_note AS "transactionNote",
          transaction.confirmed_at AS "transactionTime",
          debit.amount::text AS "mcpDeducted",
          debit.balance_after::text AS "mcpBalanceAfter"
        FROM transactions transaction
        JOIN merchant_branches branch
          ON branch.id = transaction.merchant_branch_id
        JOIN merchant_groups merchant_group
          ON merchant_group.id = branch.merchant_group_id
        JOIN markets market ON market.id = transaction.market_id
        LEFT JOIN member_profiles member_profile
          ON member_profile.member_id = transaction.member_id
        JOIN transaction_service_fees fee
          ON fee.transaction_id = transaction.id
        JOIN transaction_mcp_debits debit
          ON debit.transaction_id = transaction.id
        WHERE transaction.transaction_number = $1::bigint
          AND transaction.merchant_branch_id = ANY($2::uuid[])
        LIMIT 1
      `,
      [transactionNumber, branchIds],
    );
    const queryRows = (queryResult).rows;
    const row = queryRows[0];
    if (!row) {
      this.receiptNotFound();
    }
    return this.toMerchantReadModel(row);
  }

  async listMemberTransactions(
    accountId: string,
    query: MemberTransactionListQuery,
  ): Promise<TransactionListResponse<TransactionReadReceiptData>> {
    const memberId = await this.resolveMemberId(accountId);
    const cursor = this.decodeCursor(query.cursor);
    const result = await this.database.pool.query<TransactionReadRow>(
      `
        SELECT
          transaction.transaction_number::text AS "transactionNumber",
          transaction.status::text AS status,
          branch.merchant_id AS "publicMerchantId",
          merchant_group.name AS "merchantName",
          branch.name AS "branchName",
          transaction.protected_member_reference AS "protectedMemberReference",
          member_profile.display_name AS "memberDisplayName",
          market.code AS "marketCode",
          transaction.currency,
          transaction.purchase_amount::text AS "purchaseAmount",
          transaction.merchant_package_snapshot->>'name' AS "packageName",
          fee.rate::text AS "serviceFeeRate",
          fee.amount::text AS "serviceFeeAmount",
          transaction.reward_rate::text AS "rewardRate",
          transaction.daily_reward_amount::text AS "dailyRewardAmount",
          transaction.reward_cap::text AS "rewardCap",
          transaction.reward_start_business_date::text AS "rewardStartBusinessDate",
          transaction.merchant_receipt_number AS "merchantReceiptNumber",
          transaction.transaction_note AS "transactionNote",
          transaction.confirmed_at AS "transactionTime"
        FROM transactions transaction
        JOIN merchant_branches branch
          ON branch.id = transaction.merchant_branch_id
        JOIN merchant_groups merchant_group
          ON merchant_group.id = branch.merchant_group_id
        JOIN markets market ON market.id = transaction.market_id
        LEFT JOIN member_profiles member_profile
          ON member_profile.member_id = transaction.member_id
        JOIN transaction_service_fees fee
          ON fee.transaction_id = transaction.id
        WHERE transaction.member_id = $1::uuid
          AND ($2::transaction_status IS NULL OR transaction.status = $2)
          AND ($3::text IS NULL OR market.code = $3)
          AND ($4::timestamptz IS NULL OR transaction.confirmed_at >= $4)
          AND ($5::timestamptz IS NULL OR transaction.confirmed_at <= $5)
          AND ($6::text IS NULL OR branch.merchant_id = $6)
          AND ($7::bigint IS NULL OR transaction.transaction_number = $7)
          AND (
            $8::timestamptz IS NULL
            OR transaction.confirmed_at < $8
            OR (
              transaction.confirmed_at = $8
              AND transaction.transaction_number < $9::bigint
            )
          )
        ORDER BY transaction.confirmed_at DESC, transaction.transaction_number DESC
        LIMIT $10
      `,
      [
        memberId,
        query.status ?? null,
        query.marketCode ?? null,
        query.dateFrom ?? null,
        query.dateTo ?? null,
        query.merchantId ?? null,
        query.transactionNumber ?? null,
        cursor?.transactionTime ?? null,
        cursor?.transactionNumber ?? null,
        query.limit + 1,
      ],
    );
    return this.toMemberList((result).rows, query.limit);
  }

  async getMemberTransaction(
    accountId: string,
    transactionNumber: string,
  ): Promise<TransactionReadReceiptData> {
    if (!isTransactionNumber(transactionNumber)) {
      this.receiptNotFound();
    }
    const memberId = await this.resolveMemberId(accountId);
    const detailResult = await this.database.pool.query<TransactionReadRow>(
      `
        SELECT
          transaction.transaction_number::text AS "transactionNumber",
          transaction.status::text AS status,
          branch.merchant_id AS "publicMerchantId",
          merchant_group.name AS "merchantName",
          branch.name AS "branchName",
          transaction.protected_member_reference AS "protectedMemberReference",
          member_profile.display_name AS "memberDisplayName",
          market.code AS "marketCode",
          transaction.currency,
          transaction.purchase_amount::text AS "purchaseAmount",
          transaction.merchant_package_snapshot->>'name' AS "packageName",
          fee.rate::text AS "serviceFeeRate",
          fee.amount::text AS "serviceFeeAmount",
          transaction.reward_rate::text AS "rewardRate",
          transaction.daily_reward_amount::text AS "dailyRewardAmount",
          transaction.reward_cap::text AS "rewardCap",
          transaction.reward_start_business_date::text AS "rewardStartBusinessDate",
          transaction.merchant_receipt_number AS "merchantReceiptNumber",
          transaction.transaction_note AS "transactionNote",
          transaction.confirmed_at AS "transactionTime"
        FROM transactions transaction
        JOIN merchant_branches branch
          ON branch.id = transaction.merchant_branch_id
        JOIN merchant_groups merchant_group
          ON merchant_group.id = branch.merchant_group_id
        JOIN markets market ON market.id = transaction.market_id
        LEFT JOIN member_profiles member_profile
          ON member_profile.member_id = transaction.member_id
        JOIN transaction_service_fees fee
          ON fee.transaction_id = transaction.id
        WHERE transaction.transaction_number = $1::bigint
          AND transaction.member_id = $2::uuid
        LIMIT 1
      `,
      [transactionNumber, memberId],
    );
    const detailRows = (detailResult).rows;
    const row = detailRows[0];
    if (!row) {
      this.receiptNotFound();
    }
    return this.toSafeReceipt(row);
  }

  private async resolveMerchantBranchAccess(
    accountId: string,
  ): Promise<string[]> {
    const branchResult = await this.database.pool.query<MerchantBranchAccessRow>(
      `
        SELECT branch.id AS "branchId"
        FROM merchant_account_access merchant_access
        JOIN merchant_groups merchant_group
          ON merchant_group.id = merchant_access.merchant_group_id
        JOIN merchant_branches branch
          ON branch.merchant_group_id = merchant_group.id
        WHERE merchant_access.account_id = $1::uuid
          AND merchant_access.access_type::text IN (
            'PRIMARY_OWNER',
            'OWNER',
            'ADMIN',
            'CASHIER'
          )
        ORDER BY branch.id
      `,
      [accountId],
    );
    return (branchResult).rows.map((row) => row.branchId);
  }

  private async resolveMemberId(accountId: string): Promise<string> {
    const memberResult = await this.database.pool.query<MemberIdentityRow>(
      `
        SELECT member.id AS "memberId"
        FROM members member
        WHERE member.account_id = $1::uuid
        LIMIT 1
      `,
      [accountId],
    );
    const memberId = (memberResult).rows[0]?.memberId;
    if (!memberId) {
      this.denyReceiptAccess();
    }
    return memberId;
  }

  private toMerchantList(
    rows: TransactionReadRow[],
    limit: number,
  ): TransactionListResponse<MerchantTransactionReadModel> {
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.toMerchantReadModel(row)),
      nextCursor:
        rows.length > limit && page.length > 0
          ? this.encodeCursor(page[page.length - 1]!)
          : null,
    };
  }

  private toMemberList(
    rows: TransactionReadRow[],
    limit: number,
  ): TransactionListResponse<TransactionReadReceiptData> {
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.toSafeReceipt(row)),
      nextCursor:
        rows.length > limit && page.length > 0
          ? this.encodeCursor(page[page.length - 1]!)
          : null,
    };
  }

  private toMerchantReadModel(
    row: TransactionReadRow,
  ): MerchantTransactionReadModel {
    if (row.mcpDeducted === undefined || row.mcpBalanceAfter === undefined) {
      throw new Error('Merchant transaction MCP projection is incomplete.');
    }
    return {
      ...this.toSafeReceipt(row),
      mcpDeducted: row.mcpDeducted,
      mcpBalanceAfter: row.mcpBalanceAfter,
    };
  }

  private toSafeReceipt(row: TransactionReadRow): TransactionReadReceiptData {
    return {
      transactionNumber: row.transactionNumber,
      status: 'CONFIRMED',
      merchant: {
        merchantId: row.publicMerchantId,
        merchantName: row.merchantName,
        branchName: row.branchName,
      },
      member: {
        maskedReference: row.protectedMemberReference,
        displayName: row.memberDisplayName,
      },
      market: { marketCode: row.marketCode },
      currency: row.currency,
      purchaseAmount: row.purchaseAmount,
      package: {
        packageName: row.packageName ?? 'Custom package',
        serviceFeeRate: row.serviceFeeRate,
      },
      serviceFeeAmount: row.serviceFeeAmount,
      reward: {
        rewardRate: row.rewardRate,
        dailyRewardAmount: row.dailyRewardAmount,
        rewardCap: row.rewardCap,
        rewardStartBusinessDate: row.rewardStartBusinessDate,
      },
      merchantReceiptNumber: row.merchantReceiptNumber,
      transactionNote: row.transactionNote,
      transactionTime: new Date(row.transactionTime).toISOString(),
    };
  }

  private encodeCursor(row: TransactionReadRow): string {
    return Buffer.from(
      JSON.stringify({
        transactionTime: new Date(row.transactionTime).toISOString(),
        transactionNumber: row.transactionNumber,
      } satisfies CursorPayload),
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(cursor: string | undefined): CursorPayload | null {
    if (!cursor) return null;
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      if (
        Buffer.from(decoded, 'utf8').toString('base64url') !==
        cursor.replace(/=+$/u, '')
      ) {
        throw new Error('Non-canonical cursor.');
      }
      const value = JSON.parse(decoded) as unknown;
      if (!isCursorPayload(value)) {
        throw new Error('Invalid cursor payload.');
      }
      return value;
    } catch {
      transactionBadRequest(
        transactionErrorCodes.listCursorInvalid,
        'The transaction list cursor is invalid.',
      );
    }
  }

  private receiptNotFound(): never {
    transactionNotFound(
      transactionErrorCodes.receiptNotFound,
      'The transaction receipt was not found.',
    );
  }

  private denyReceiptAccess(): never {
    transactionForbidden(
      transactionErrorCodes.receiptAccessDenied,
      'The authenticated account cannot access transaction receipts.',
    );
  }
}

function isTransactionNumber(value: string): boolean {
  return /^[1-9]\d*$/u.test(value) && value.length <= 30;
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    typeof record['transactionTime'] === 'string' &&
    !Number.isNaN(Date.parse(record['transactionTime'])) &&
    new Date(record['transactionTime']).toISOString() ===
      record['transactionTime'] &&
    typeof record['transactionNumber'] === 'string' &&
    isTransactionNumber(record['transactionNumber'])
  );
}
