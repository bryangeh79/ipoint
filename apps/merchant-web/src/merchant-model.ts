export type MerchantOperationalStatus =
  | 'PENDING_APPLICATION'
  | 'PENDING_KYC'
  | 'PENDING_MCP'
  | 'ACTIVE'
  | 'SUSPENDED';

export interface ActivationState {
  emailVerified: boolean;
  termsAccepted: boolean;
  applicationApproved: boolean;
  kycApproved: boolean;
  mcpBalance: string;
  previouslyActivated?: boolean;
}

export function activationHints(state: ActivationState): string[] {
  const hints: string[] = [];
  if (!state.emailVerified) hints.push('Verify your login email');
  if (!state.termsAccepted)
    hints.push('Accept the current terms and disclaimer');
  if (!state.applicationApproved) hints.push('Complete application approval');
  if (!state.kycApproved) hints.push('Complete KYC approval');
  if (!state.previouslyActivated && Number(state.mcpBalance) < 100) {
    hints.push('Reach the initial 100 MCP activation balance');
  }
  return hints;
}

export function onboardingProgress(state: ActivationState): number {
  const checks = [
    state.emailVerified,
    state.termsAccepted,
    state.applicationApproved,
    state.kycApproved,
    state.previouslyActivated || Number(state.mcpBalance) >= 100,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function operationalStatus(
  state: ActivationState,
  suspended = false,
): MerchantOperationalStatus {
  if (suspended) return 'SUSPENDED';
  if (!state.applicationApproved) return 'PENDING_APPLICATION';
  if (!state.kycApproved) return 'PENDING_KYC';
  if (!state.previouslyActivated && Number(state.mcpBalance) < 100) {
    return 'PENDING_MCP';
  }
  return 'ACTIVE';
}
