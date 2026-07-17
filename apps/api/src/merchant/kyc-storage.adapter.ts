import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export const KYC_STORAGE_ADAPTER = Symbol('KYC_STORAGE_ADAPTER');

export interface KycUploadIntent {
  storageKey: string;
  expiresAt: string;
  method: 'MOCK';
  uploadUrl: null;
}

export interface KycPrivateReadContract {
  storageKey: string;
  expiresAt: string;
  signedUrl: null;
}

export interface KycStorageAdapter {
  createUploadIntent(input: { branchId: string }): KycUploadIntent;
  createPrivateReadContract(input: {
    storageKey: string;
  }): KycPrivateReadContract;
}

@Injectable()
export class DevelopmentKycStorageAdapter implements KycStorageAdapter {
  private static readonly contractLifetimeMs = 5 * 60 * 1000;

  createUploadIntent(input: { branchId: string }): KycUploadIntent {
    return {
      storageKey: `merchant-kyc/${input.branchId}/${randomUUID()}`,
      expiresAt: this.expiry(),
      method: 'MOCK',
      uploadUrl: null,
    };
  }

  createPrivateReadContract(input: {
    storageKey: string;
  }): KycPrivateReadContract {
    return {
      storageKey: input.storageKey,
      expiresAt: this.expiry(),
      signedUrl: null,
    };
  }

  private expiry(): string {
    return new Date(
      Date.now() + DevelopmentKycStorageAdapter.contractLifetimeMs,
    ).toISOString();
  }
}
