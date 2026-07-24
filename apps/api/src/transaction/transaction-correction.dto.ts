import { z } from 'zod';

export const transactionCorrectionRequestSchema = z
  .object({
    reasonCode: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Z0-9][A-Z0-9_-]*$/u),
    reasonNote: z
      .string()
      .max(500)
      .refine((value) =>
        [...value].every((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return (
            codePoint === 9 ||
            codePoint === 10 ||
            codePoint === 13 ||
            (codePoint >= 32 && codePoint !== 127)
          );
        }),
      )
      .nullable()
      .optional(),
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
