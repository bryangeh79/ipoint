/**
 * Commission Calculation Domain Module
 *
 * Barrel export for commission domain services, types, and errors.
 *
 * @packageDocumentation
 */

export { AgentUpgradeCommissionService } from './agent-upgrade.service.js';
export {
  AgentUpgradeCommissionError,
  upgradeActivationNotFoundError,
  upgradeActivationNotActiveError,
  upgradeRateNotFoundError,
  upgradeProcessingConflictError,
} from './agent-upgrade.errors.js';
export type { AgentUpgradeCommissionErrorCode } from './agent-upgrade.errors.js';
export type {
  AgentUpgradeCommissionResult,
  AgentUpgradeGenerationResult,
  AgentUpgradeCommissionsResponse,
  AgentUpgradeLedgerEntry,
} from './agent-upgrade.types.js';
