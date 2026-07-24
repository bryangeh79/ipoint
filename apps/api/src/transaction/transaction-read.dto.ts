import { z } from 'zod';
import {
  transactionBadRequest,
  transactionErrorCodes,
} from './transaction.errors.js';

const transactionNumberSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/u)
  .max(30);

const isoDateTimeSchema = z.string().trim().datetime({ offset: true });

const commonListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(1000).optional(),
  limit: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .refine((value) => value <= 100)
    .default(20),
  status: z.literal('CONFIRMED').optional(),
  marketCode: z
    .string()
    .trim()
    .min(2)
    .max(10)
    .transform((value) => value.toUpperCase())
    .optional(),
  dateFrom: isoDateTimeSchema.optional(),
  dateTo: isoDateTimeSchema.optional(),
});

export const merchantTransactionListQuerySchema = commonListQuerySchema
  .extend({
    branchId: z.string().uuid().optional(),
    merchantReceiptNumber: z.string().trim().min(1).max(100).optional(),
    transactionNumber: transactionNumberSchema.optional(),
  })
  .strict();

export const memberTransactionListQuerySchema = commonListQuerySchema
  .extend({
    merchantId: z.string().trim().min(1).max(100).optional(),
    transactionNumber: transactionNumberSchema.optional(),
  })
  .strict();

export type MerchantTransactionListQuery = z.infer<
  typeof merchantTransactionListQuerySchema
>;
export type MemberTransactionListQuery = z.infer<
  typeof memberTransactionListQuerySchema
>;

export function parseMerchantTransactionListQuery(
  input: unknown,
): MerchantTransactionListQuery {
  return parseListQuery(merchantTransactionListQuerySchema, input);
}

export function parseMemberTransactionListQuery(
  input: unknown,
): MemberTransactionListQuery {
  return parseListQuery(memberTransactionListQuerySchema, input);
}

function parseListQuery<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    transactionBadRequest(
      transactionErrorCodes.listFilterInvalid,
      'The transaction list filters are invalid.',
    );
  }
  const query = parsed.data as T & {
    dateFrom?: string;
    dateTo?: string;
  };
  if (
    query.dateFrom &&
    query.dateTo &&
    new Date(query.dateFrom).getTime() > new Date(query.dateTo).getTime()
  ) {
    transactionBadRequest(
      transactionErrorCodes.listFilterInvalid,
      'dateFrom must not be after dateTo.',
    );
  }
  return parsed.data;
}

export interface TransactionReadMerchant {
  merchantId: string;
  merchantName: string;
  branchName: string;
}

export interface TransactionReadReceiptData {
  transactionNumber: string;
  status: 'CONFIRMED';
  merchant: TransactionReadMerchant;
  member: {
    maskedReference: string;
    displayName: string | null;
  };
  market: {
    marketCode: string;
  };
  currency: string;
  purchaseAmount: string;
  package: {
    packageName: string;
    serviceFeeRate: string;
  };
  serviceFeeAmount: string;
  reward: {
    rewardRate: string;
    dailyRewardAmount: string;
    rewardCap: string;
    rewardStartBusinessDate: string;
  };
  merchantReceiptNumber: string | null;
  transactionNote: string | null;
  transactionTime: string;
}

export interface MerchantTransactionReadModel extends TransactionReadReceiptData {
  mcpDeducted: string;
  mcpBalanceAfter: string;
}

export interface TransactionListResponse<T> {
  items: T[];
  nextCursor: string | null;
}
