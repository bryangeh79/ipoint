/**
 * Agent Upgrade Commission Domain Errors
 *
 * Defines domain-specific error types for agent upgrade
 * commission calculation operations.
 *
 * @packageDocumentation
 */

/* ------------------------------------------------------------------ */
/*  Error Codes                                                        */
/* ------------------------------------------------------------------ */

export type AgentUpgradeCommissionErrorCode =
  | 'AGENT_UPGRADE_ACTIVATION_NOT_FOUND'
  | 'AGENT_UPGRADE_ACTIVATION_NOT_ACTIVE'
  | 'AGENT_UPGRADE_RATE_NOT_FOUND'
  | 'AGENT_UPGRADE_PROCESSING_CONFLICT';

/* ------------------------------------------------------------------ */
/*  Error Class                                                        */
/* ------------------------------------------------------------------ */

export class AgentUpgradeCommissionError extends Error {
  constructor(
    readonly code: AgentUpgradeCommissionErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentUpgradeCommissionError';
  }
}

/* ------------------------------------------------------------------ */
/*  Factory Functions                                                  */
/* ------------------------------------------------------------------ */

export function upgradeActivationNotFoundError(
  activationId: string,
): AgentUpgradeCommissionError {
  return new AgentUpgradeCommissionError(
    'AGENT_UPGRADE_ACTIVATION_NOT_FOUND',
    `Agent activation record not found: ${activationId}`,
    { activationId },
  );
}

export function upgradeActivationNotActiveError(
  activationId: string,
  status: string,
): AgentUpgradeCommissionError {
  return new AgentUpgradeCommissionError(
    'AGENT_UPGRADE_ACTIVATION_NOT_ACTIVE',
    `Agent activation ${activationId} is not ACTIVE (current status: ${status}). Commission can only be processed for ACTIVE agents.`,
    { activationId, currentStatus: status },
  );
}

export function upgradeRateNotFoundError(
  market: string,
  generation: number,
  effectiveTime: string,
): AgentUpgradeCommissionError {
  return new AgentUpgradeCommissionError(
    'AGENT_UPGRADE_RATE_NOT_FOUND',
    `No commission rate version found for AGENT_UPGRADE, generation ${generation}, market ${market}, effective at ${effectiveTime}.`,
    { market, generation, effectiveTime },
  );
}

export function upgradeProcessingConflictError(
  activationId: string,
): AgentUpgradeCommissionError {
  return new AgentUpgradeCommissionError(
    'AGENT_UPGRADE_PROCESSING_CONFLICT',
    `Agent upgrade commission for activation ${activationId} has already been processed or is in flight.`,
    { activationId },
  );
}
