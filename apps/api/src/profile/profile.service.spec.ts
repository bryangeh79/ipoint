import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { ProfileError } from './profile.types.js';
import { ProfileService } from './profile.service.js';

describe('ProfileService', () => {
  const accountId = randomUUID();
  const memberId = randomUUID();

  function createMockDb() {
    return {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(),
      orderBy: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
    };
  }

  function makeService(db: ReturnType<typeof createMockDb>) {
    return new ProfileService({ db } as unknown as DatabaseService);
  }

  it('getProfile: returns profile', async () => {
    const db = createMockDb();
    db.limit.mockResolvedValueOnce([{ id: memberId }]); // resolveMemberId
    db.limit.mockResolvedValueOnce([
      {
        id: randomUUID(),
        memberId,
        displayName: 'John Doe',
        fullName: null,
        phone: null,
        birthDate: null,
        address: null,
        avatarObjectKey: null,
        language: null,
        locale: null,
        marketingOptIn: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]); // getProfile
    const svc = makeService(db);
    const result = await svc.getProfile(accountId);
    expect(result.displayName).toBe('John Doe');
  });

  it('getProfile: throws for missing member', async () => {
    const db = createMockDb();
    db.limit.mockResolvedValueOnce([]); // resolveMemberId returns empty
    const svc = makeService(db);
    await expect(svc.getProfile(accountId)).rejects.toThrow(ProfileError);
  });

  it('updateProfile: rejects future birth date', async () => {
    const db = createMockDb();
    db.limit.mockResolvedValueOnce([{ id: memberId }]); // resolveMemberId
    const svc = makeService(db);
    await expect(
      svc.updateProfile(accountId, { birthDate: '2099-01-01' }, {}),
    ).rejects.toThrow(ProfileError);
  });

  it('updateProfile: rejects under-18', async () => {
    const db = createMockDb();
    db.limit.mockResolvedValueOnce([{ id: memberId }]); // resolveMemberId
    const svc = makeService(db);
    await expect(
      svc.updateProfile(accountId, { birthDate: '2010-01-01' }, {}),
    ).rejects.toThrow(ProfileError);
  });

  it('updateProfile: rejects duplicate phone', async () => {
    const db = createMockDb();
    db.limit.mockResolvedValueOnce([{ id: memberId }]); // resolveMemberId
    db.limit.mockResolvedValueOnce([{ id: randomUUID() }]); // phone duplicate
    const svc = makeService(db);
    await expect(
      svc.updateProfile(accountId, { phone: '+60123456789' }, {}),
    ).rejects.toThrow(ProfileError);
  });
});
