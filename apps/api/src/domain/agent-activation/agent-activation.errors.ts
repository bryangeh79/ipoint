/**
 * Agent Activation Lifecycle Domain Errors
 *
 * Defines domain-specific error types for agent activation operations.
 *
 * @packageDocumentation
 */

import type { AgentActivationStatus } from '@ipoint/types';

/* ------------------------------------------------------------------ */
/*  Error Codes                                                        */
/* ------------------------------------------------------------------ */

export type AgentActivationErrorCode =
  | 'AGENT_ACTIVATION_NOT_FOUND'
  | 'AGENT_ACTIVATION_ALREADY_EXISTS'
  | 'AGENT_ACTIVATION_INVALID_TRANSITION'
  | 'AGENT_ACTIVATION_INVALID_STATUS'
  | 'AGENT_ACTIVATION_ALREADY_ACTIVE'
  | 'AGENT_ACTIVATION_ALREADY_SUSPENDED'
  | 'AGENT_ACTIVATION_ALREADY_DEACTIVATED'
  | 'AGENT_ACTIVATION_ALREADY_REJECTED'
  | 'AGENT_ACTIVATION_MISSING_PAYMENT'
  | 'AGENT_ACTIVATION_MISSING_COURSE'
  | 'AGENT_ACTIVATION_MISSING_APPROVAL'
  | 'AGENT_ACTIVATION_PAYMENT_ALREADY_CONFIRMED'
  | 'AGENT_ACTIVATION_COURSE_ALREADY_COMPLETED'
  | 'AGENT_ACTIVATION_MARKET_ALREADY_EXISTS'
  | 'AGENT_ACTIVATION_IDEMPOTENCY_CONFLICT'
  | 'AGENT_ACTIVATION_FEE_NOT_CONFIGURED'
  | 'AGENT_ACTIVATION_DEACTIVATED_CANNOT_REACTIVATE'
  | 'AGENT_ACTIVATION_REJECTED_CANNOT_TRANSITION';

/* ------------------------------------------------------------------ */
/*  Error Class                                                        */
/* ------------------------------------------------------------------ */

export class AgentActivationError extends Error {
  constructor(
    readonly code: AgentActivationErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentActivationError';
  }
}

/* ------------------------------------------------------------------ */
/*  Factory Functions                                                  */
/* ------------------------------------------------------------------ */

export function activationNotFoundError(
  activationId: string,
): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_NOT_FOUND',
    `Agent activation record not found: ${activationId}`,
    { activationId },
  );
}

export function activationAlreadyExistsError(
  memberId: string,
  market: string,
): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_ALREADY_EXISTS',
    `An activation record already exists for member ${memberId} in market ${market}.`,
    { memberId, market },
  );
}

export function activationInvalidTransitionError(
  fromStatus: AgentActivationStatus,
  action: string,
  reason?: string,
): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_INVALID_TRANSITION',
    reason ?? `Cannot perform ${action} from status ${fromStatus}.`,
    { fromStatus, action, reason },
  );
}

export function activationInvalidStatusError(
  currentStatus: AgentActivationStatus,
  expectedStatus: AgentActivationStatus,
): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_INVALID_STATUS',
    `Expected status ${expectedStatus}, but current status is ${currentStatus}.`,
    { currentStatus, expectedStatus },
  );
}

export function activationAlreadyActiveError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_ALREADY_ACTIVE',
    'The agent is already active.',
  );
}

export function activationAlreadySuspendedError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_ALREADY_SUSPENDED',
    'The agent is already suspended.',
  );
}

export function activationAlreadyDeactivatedError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_ALREADY_DEACTIVATED',
    'The agent has already been deactivated.',
  );
}

export function activationAlreadyRejectedError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_ALREADY_REJECTED',
    'The application has already been rejected. A rejected application cannot transition to any other status.',
  );
}

export function activationMissingPaymentError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_MISSING_PAYMENT',
    'Payment must be confirmed before proceeding.',
  );
}

export function activationMissingCourseError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_MISSING_COURSE',
    'Course must be completed before proceeding.',
  );
}

export function activationMissingApprovalError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_MISSING_APPROVAL',
    'Approval must be submitted before activation.',
  );
}

export function activationPaymentAlreadyConfirmedError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_PAYMENT_ALREADY_CONFIRMED',
    'Payment has already been confirmed for this activation.',
  );
}

export function activationCourseAlreadyCompletedError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_COURSE_ALREADY_COMPLETED',
    'Course has already been completed for this activation.',
  );
}

export function activationMarketAlreadyExistsError(
  memberId: string,
  market: string,
): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_MARKET_ALREADY_EXISTS',
    `Member ${memberId} already has an activation record in market ${market}.`,
    { memberId, market },
  );
}

export function activationIdempotencyConflictError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}

export function activationFeeNotConfiguredError(
  market: string,
): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_FEE_NOT_CONFIGURED',
    `Activation fee not configured for market ${market}.`,
    { market },
  );
}

export function activationDeactivatedCannotReactivateError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_DEACTIVATED_CANNOT_REACTIVATE',
    'A deactivated agent cannot be reactivated. DEACTIVATED is a terminal state.',
  );
}

export function activationRejectedCannotTransitionError(): AgentActivationError {
  return new AgentActivationError(
    'AGENT_ACTIVATION_REJECTED_CANNOT_TRANSITION',
    'A rejected application cannot transition to any other status. REJECTED is a terminal state.',
  );
}
