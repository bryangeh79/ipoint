import { AgentOpsError } from './admin-agent-ops.types.js';

/** The market does not exist. */
export function agentMarketNotFoundError(): AgentOpsError {
  return new AgentOpsError(
    'AGENT_MARKET_NOT_FOUND',
    'The market was not found.',
  );
}

/** The agent activation record does not exist. */
export function agentNotFoundError(agentId: string): AgentOpsError {
  return new AgentOpsError(
    'AGENT_NOT_FOUND',
    `Agent activation record not found: ${agentId}`,
    { agentId },
  );
}

/**
 * The market has no effective AGENT_ACTIVATION_FEE version — the explicit
 * capability-unavailable state (P5 owner precondition). The surface NEVER
 * falls back to Malaysia or any other market fee.
 */
export function agentFeeNotConfiguredError(marketCode: string): AgentOpsError {
  return new AgentOpsError(
    'AGENT_FEE_NOT_CONFIGURED',
    `Agent activation for market ${marketCode} is not configured yet. An effective activation fee must be approved before agent operations are available.`,
    { marketCode },
  );
}

/** A mandatory reason is required for this status operation. */
export function agentReasonRequiredError(): AgentOpsError {
  return new AgentOpsError(
    'REASON_REQUIRED',
    'A reason is required for this operation.',
  );
}
