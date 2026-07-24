import { z } from 'zod';

export const transactionCorrectionRequestSchema = z
  .object({
    reasonCode: z.string().trim().min(1).max(64),
    reasonNote: z.string().max(500).nullable().optional(),
  })
  .strict();

export type TransactionCorrectionRequestDto = z.infer<
  typeof transactionCorrectionRequestSchema
>;

export type TransactionCorrectionType = 'REVERSAL' | 'REFUND';
export type TransactionCorrectionStatus = 'REQUESTED' | 'EXECUTED' | 'REJECTED';

export interface TransactionCorrectionResponse {
  transactionNumber: string;
  requestType: TransactionCorrectionType;
  status: TransactionCorrectionStatus;
  reasonCode: string;
  reasonNote: string | null;
  requestedAt: string;
  executedAt: string | null;
  rejectedAt: string | null;
}

export interface TransactionCorrectionExecutionResponse {
  transactionNumber: string;
  requestType: TransactionCorrectionType;
  status: 'REVERSED' | 'REFUNDED';
  executedAt: string;
}
