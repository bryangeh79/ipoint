export class WalletError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
  }
}

export interface WalletAccountResponse {
  id: string;
  memberId: string;
  marketId: string;
  pendingBalance: string;
  availableBalance: string;
  reversedBalance: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WalletEntryResponse {
  id: string;
  walletAccountId: string;
  memberId: string;
  marketId: string;
  entrySequence: number;
  entryType: string;
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
  createdAt: string;
}

export interface PaginatedWalletEntriesResponse {
  entries: WalletEntryResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface WalletBalanceResponse {
  pending: string;
  available: string;
  reversed: string;
}

export interface CreateLedgerEntryParams {
  memberId: string;
  marketId: string;
  entryType: 'PENDING' | 'AVAILABLE' | 'REVERSED' | 'COMPENSATION' | 'ADJUSTMENT';
  amount: string;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  reason?: string;
  actorId?: string;
  marketTimezone?: string;
}
