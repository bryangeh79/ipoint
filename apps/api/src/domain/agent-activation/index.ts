/**
 * Agent Activation Lifecycle Domain Module
 *
 * Barrel export for the agent activation lifecycle domain service,
 * types, and errors.
 *
 * @packageDocumentation
 */

export { AgentActivationService } from './agent-activation.service.js';
export {
  AgentActivationError,
  activationNotFoundError,
  activationAlreadyExistsError,
  activationInvalidTransitionError,
  activationInvalidStatusError,
  activationAlreadyActiveError,
  activationAlreadySuspendedError,
  activationAlreadyDeactivatedError,
  activationAlreadyRejectedError,
  activationMissingPaymentError,
  activationMissingCourseError,
  activationMissingApprovalError,
  activationPaymentAlreadyConfirmedError,
  activationCourseAlreadyCompletedError,
  activationMarketAlreadyExistsError,
  activationIdempotencyConflictError,
  activationFeeNotConfiguredError,
  activationDeactivatedCannotReactivateError,
  activationRejectedCannotTransitionError,
} from './agent-activation.errors.js';
export type { AgentActivationErrorCode } from './agent-activation.errors.js';
export type {
  AgentActivationRepository,
  AgentActivationFilter,
  ActivationFeeConfigStore,
  TransitionContext,
  CreateActivationDto,
} from './agent-activation.types.js';
