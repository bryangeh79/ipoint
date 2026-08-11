/**
 * L-06 member QR surface - request DTOs (zod).
 *
 * RotateMemberQrRequest / RevokeMemberQrRequest per the frozen Phase 2
 * route table. The idempotency key is read from the `Idempotency-Key`
 * header (canonical channel, already redacted in the pino config) or the
 * optional body field; at least one must be present on POST/DELETE
 * (idempotency Required per contract). RevokeMemberQrRequest also carries
 * an optional non-sensitive revocation `reason` (stored on the row; never
 * echoed back with token material).
 */

import { z } from 'zod';

const idempotencyKeyField = z.string().trim().min(1).max(200).optional();

const revokeReasonField = z.string().trim().min(1).max(200).optional();

export const rotateMemberQrSchema = z
  .object({
    idempotencyKey: idempotencyKeyField,
  })
  .strict();

export const revokeMemberQrSchema = z
  .object({
    idempotencyKey: idempotencyKeyField,
    reason: revokeReasonField,
  })
  .strict();

export type RotateMemberQrDto = z.infer<typeof rotateMemberQrSchema>;
export type RevokeMemberQrDto = z.infer<typeof revokeMemberQrSchema>;
