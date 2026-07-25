import { z } from 'zod';

export const MARKET_REGEX = /^[A-Z]{2}$/;

export const agentActivationApplySchema = z.object({
  market: z.string().regex(MARKET_REGEX, 'Market must be a 2-letter ISO code (e.g. MY, SG)'),
});

export const agentActivationPaymentSchema = z.object({
  activationId: z.string().uuid(),
  paymentReference: z.string().min(1).max(255),
});

export const agentActivationCourseEnrollSchema = z.object({
  activationId: z.string().uuid(),
});

export const agentActivationCourseCompleteSchema = z.object({
  activationId: z.string().uuid(),
});

export const agentActivationApproveSchema = z.object({
  activationId: z.string().uuid(),
});

export const agentActivationRejectSchema = z.object({
  activationId: z.string().uuid(),
  reason: z.string().min(1).max(500).optional(),
});

export const agentActivationSuspendSchema = z.object({
  activationId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export const agentActivationReactivateSchema = z.object({
  activationId: z.string().uuid(),
});

export const agentActivationDeactivateSchema = z.object({
  activationId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export const agentStatusQuerySchema = z.object({
  memberId: z.string().uuid().optional(),
  market: z.string().regex(MARKET_REGEX).optional(),
});

export function getExpectedTargetStatus(
  fromStatus: string,
  action: string,
): string | undefined {
  const map: Record<string, string> = {
    'NOT_APPLIED:APPLY': 'PENDING_PAYMENT',
    'PENDING_PAYMENT:CONFIRM_PAYMENT': 'PAYMENT_CONFIRMED',
    'PAYMENT_CONFIRMED:ENROLL_COURSE': 'COURSE_PENDING',
    'COURSE_PENDING:COMPLETE_COURSE': 'COURSE_COMPLETED',
    'COURSE_COMPLETED:SUBMIT_FOR_APPROVAL': 'PENDING_APPROVAL',
    'PENDING_APPROVAL:APPROVE_AND_ACTIVATE': 'ACTIVE',
    'PENDING_PAYMENT:REJECT': 'REJECTED',
    'PAYMENT_CONFIRMED:REJECT': 'REJECTED',
    'COURSE_PENDING:REJECT': 'REJECTED',
    'COURSE_COMPLETED:REJECT': 'REJECTED',
    'PENDING_APPROVAL:REJECT': 'REJECTED',
    'ACTIVE:SUSPEND': 'SUSPENDED',
    'SUSPENDED:REACTIVATE': 'ACTIVE',
    'ACTIVE:DEACTIVATE': 'DEACTIVATED',
  };
  return map[`${fromStatus}:${action}`];
}

export function validateTransition(
  fromStatus: string,
  action: string,
  toStatus: string,
): { allowed: boolean; reason?: string } {
  const target = getExpectedTargetStatus(fromStatus, action);
  if (target === toStatus) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Transition from ${fromStatus} via ${action} to ${toStatus} is not allowed.`,
  };
}
