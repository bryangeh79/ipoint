/**
 * Agent Upgrade Commission Domain Types
 *
 * Types for the agent upgrade commission calculation service.
 *
 * @packageDocumentation
 */

/* ------------------------------------------------------------------ */
/*  Commission Result                                                  */
/* ------------------------------------------------------------------ */

/**
 * Commission result for a single generation (G1 or G2).
 */
export interface AgentUpgradeGenerationResult {
  generation: number;
  beneficiaryId: string | null;
  beneficiaryActiveAtSource: boolean;
  amount: string | null;
  entryType: 'AGENT_UPGRADE_G1_EARN' | 'AGENT_UPGRADE_G2_EARN' | null;
  outcome:
    | 'CREATED'
    | 'SKIPPED_INELIGIBLE'
    | 'SKIPPED_NO_BENEFICIARY'
    | 'SKIPPED_ZERO_AMOUNT';
  ledgerEntryId: string | null;
  reason: string | null;
}

/**
 * Overall result of processing an agent upgrade commission.
 */
export interface AgentUpgradeCommissionResult {
  activationId: string;
  memberId: string;
  market: string;
  activatedAt: string;
  processingId: string;
  completionOutcome: 'CREATED' | 'SKIPPED_INELIGIBLE' | 'FAILED';
  generations: AgentUpgradeGenerationResult[];
}

/**
 * Return type for getUpgradeCommission queries.
 */
export interface AgentUpgradeLedgerEntry {
  entryId: string;
  publicReference: string;
  beneficiaryId: string;
  sourceType: string;
  sourceReference: string;
  market: string;
  currency: string;
  amount: string;
  generation: number;
  entryType: string;
  postingStatus: string;
  effectiveTime: string;
  rateSnapshot: Record<string, unknown> | null;
  createdAt: string;
}

export interface AgentUpgradeCommissionsResponse {
  activationId: string;
  memberId: string;
  market: string;
  activatedAt: string | null;
  commissions: AgentUpgradeLedgerEntry[];
}
