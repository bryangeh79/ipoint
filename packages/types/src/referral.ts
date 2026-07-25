/**
 * Referral Domain Types
 *
 * Defines shared types for the referral engine.
 *
 * @packageDocumentation
 */

export interface ReferralTreeResponse {
  myCode: string;
  referrer: {
    maskedReference: string;
    isAgent: boolean;
  } | null;
  referrals: {
    g1Count: number;
    g2Count: number;
    g1Agents: number;
    g2Agents: number;
  };
}
