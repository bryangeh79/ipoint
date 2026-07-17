import { describe, expect, it } from 'vitest';
import {
  activationHints,
  onboardingProgress,
  operationalStatus,
} from './merchant-model.js';

const ready = {
  emailVerified: true,
  termsAccepted: true,
  applicationApproved: true,
  kycApproved: true,
  mcpBalance: '125.0000000000',
};

describe('merchant activation presentation', () => {
  it('shows every missing condition without inventing activation', () => {
    expect(
      activationHints({
        emailVerified: false,
        termsAccepted: false,
        applicationApproved: false,
        kycApproved: false,
        mcpBalance: '0',
      }),
    ).toEqual([
      'Verify your login email',
      'Accept the current terms and disclaimer',
      'Complete application approval',
      'Complete KYC approval',
      'Reach the initial 100 MCP activation balance',
    ]);
  });

  it('computes the complete onboarding state', () => {
    expect(onboardingProgress(ready)).toBe(100);
    expect(operationalStatus(ready)).toBe('ACTIVE');
    expect(operationalStatus(ready, true)).toBe('SUSPENDED');
  });

  it('does not deactivate a previously activated merchant below 100 MCP', () => {
    expect(
      operationalStatus({
        ...ready,
        mcpBalance: '12',
        previouslyActivated: true,
      }),
    ).toBe('ACTIVE');
  });
});
