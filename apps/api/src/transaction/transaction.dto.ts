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
