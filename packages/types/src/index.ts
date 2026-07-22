export type MarketCode = string;

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  version: string;
}

export type WalletEntryType =
  | 'PENDING'
  | 'AVAILABLE'
  | 'REVERSED'
  | 'COMPENSATION'
  | 'ADJUSTMENT';

export interface WalletAccount {
  id: string;
  memberId: string;
  marketId: string;
  pendingBalance: string;
  availableBalance: string;
  reversedBalance: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletEntry {
  id: string;
  walletAccountId: string;
  memberId: string;
  marketId: string;
  entrySequence: string;
  entryType: WalletEntryType;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  idempotencyKey: string;
  referenceType: string | null;
  referenceId: string | null;
  description: string | null;
  reason: string | null;
  actorId: string | null;
  marketTimezone: string | null;
  createdAt: Date;
}

export interface WalletBalance {
  pending: string;
  available: string;
  reversed: string;
}
