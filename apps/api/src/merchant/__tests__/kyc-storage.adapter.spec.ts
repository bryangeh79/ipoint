import { describe, expect, it, vi } from 'vitest';
import { DevelopmentKycStorageAdapter } from '../kyc-storage.adapter.js';

describe('DevelopmentKycStorageAdapter', () => {
  it('creates private mock contracts without exposing a public URL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
    const adapter = new DevelopmentKycStorageAdapter();

    const upload = adapter.createUploadIntent({ branchId: 'branch-1' });
    const read = adapter.createPrivateReadContract({
      storageKey: upload.storageKey,
    });

    expect(upload).toMatchObject({
      method: 'MOCK',
      uploadUrl: null,
      expiresAt: '2026-07-17T00:05:00.000Z',
    });
    expect(upload.storageKey).toMatch(/^merchant-kyc\/branch-1\//u);
    expect(read).toEqual({
      storageKey: upload.storageKey,
      expiresAt: '2026-07-17T00:05:00.000Z',
      signedUrl: null,
    });

    vi.useRealTimers();
  });
});
