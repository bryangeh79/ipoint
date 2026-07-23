import { z } from 'zod';

const decimalString = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[+-]?\d+(?:\.\d+)?$/u, 'amount must be a decimal string');

export const transactionPreviewSchema = z
  .object({
    amount: decimalString,
    memberQrToken: z.string().trim().min(1).max(2048),
    packageId: z.string().uuid().optional(),
    marketId: z.string().uuid().optional(),
    transactionNote: z.string().max(200).optional(),
  })
  .strict();

export type TransactionPreviewDto = z.infer<typeof transactionPreviewSchema>;

export interface TransactionPreviewResponse {
  previewSessionId: string;
  protectedMemberReference: string;
  amount: string;
  currency: string;
  selectedPackage: {
    id: string;
    name: string;
    rate: string;
  };
  serviceFeeRate: string;
  estimatedMcpDebit: string;
  currentMcpBalance: string;
  estimatedMcpBalanceAfter: string;
  mcpSufficient: boolean;
  confirmAllowed: boolean;
  mcpShortfall: string;
  rewardRate: string;
  expectedDailyRewardAmount: string;
  rewardCap: string;
  rewardStartDate: string;
  transactionMarket: {
    id: string;
    code: string;
    timezone: string;
  };
  previewExpiresAt: string;
}

export const transactionConfirmSchema = z
  .object({
    merchantReceiptNumber: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type TransactionConfirmDto = z.infer<typeof transactionConfirmSchema>;

export interface TransactionMerchantResponse {
  merchantId: string;
  merchantName: string;
  branchId: string | null;
  branchName: string | null;
}

export interface TransactionReceiptData {
  transactionNumber: string;
  status: 'CONFIRMED';
  merchant: TransactionMerchantResponse;
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
    packageId: string;
    packageName: string;
    serviceFeeRate: string;
  };
  serviceFeeAmount: string;
  reward: {
    rewardRuleVersionId: string;
    rewardRate: string;
    dailyRewardAmount: string;
    rewardCap: string;
    rewardStartBusinessDate: string;
  };
  merchantReceiptNumber: string | null;
  transactionNote: string | null;
  transactionTime: string;
}

export interface TransactionConfirmResponse {
  transactionNumber: string;
  status: 'CONFIRMED';
  transactionTime: string;
  merchant: TransactionMerchantResponse;
  market: {
    marketCode: string;
  };
  currency: string;
  amount: string;
  serviceFee: string;
  mcpDeducted: string;
  mcpBalanceAfter: string;
  rewardRuleVersion: string;
  dailyRewardAmount: string;
  rewardCap: string;
  rewardStartBusinessDate: string;
  receiptData: TransactionReceiptData;
}
