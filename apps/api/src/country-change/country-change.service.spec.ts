import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { CountryChangeError } from './country-change.errors.js';
import { CountryChangeService } from './country-change.service.js';

describe('CountryChangeService', () => {
  const accountId = randomUUID();
  const memberId = randomUUID();

  function createService(
    options: {
      currentCountry?: string;
      memberExists?: boolean;
      pendingRequest?: boolean;
      cancelNonPendingStatus?: string | null;
    } = {},
  ) {
    const currentCountry = options.currentCountry ?? 'MY';
    const memberExists = options.memberExists ?? true;
    const pendingRequest = options.pendingRequest ?? false;

    const queryBuilder = {
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
    };

    // Mock for resolveMemberId
    queryBuilder.limit.mockResolvedValueOnce(
      memberExists ? [{ id: memberId, accountId }] : [],
    );

    // Mock for getting account country
    queryBuilder.limit.mockResolvedValueOnce([{ accountCountry: currentCountry }]);

    if (options.pendingRequest) {
      queryBuilder.limit.mockResolvedValueOnce([{ id: randomUUID() }]);
    } else {
      queryBuilder.limit.mockResolvedValueOnce([]);
    }

    // Mock for insert returning
    if (pendingRequest) {
      // Not used in this path - submit will throw
    } else {
      const now = new Date();
      queryBuilder.returning.mockResolvedValueOnce([
        {
          id: randomUUID(),
          memberId,
          accountId,
          currentCountry,
          requestedCountry: 'SG',
          status: 'PENDING',
          reason: 'Moving to Singapore',
          reviewedByAdminUserId: null,
          reviewReason: null,
          submittedAt: now,
          reviewedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    const databaseService = { db: queryBuilder };

    return {
      service: new CountryChangeService(databaseService as unknown as DatabaseService),
      db: databaseService,
    };
  }

  describe('submit', () => {
    it('creates a country change request successfully', async () => {
      const { service } = createService({
        currentCountry: 'MY',
        pendingRequest: false,
      });

      const result = await service.submit(
        accountId,
        'SG',
        'Moving to Singapore',
      );

      expect(result.currentCountry).toBe('MY');
      expect(result.requestedCountry).toBe('SG');
      expect(result.status).toBe('PENDING');
      expect(result.reason).toBe('Moving to Singapore');
    });

    it('rejects when requested country is the same as current', async () => {
      const { service: svc1 } = createService({
        currentCountry: 'MY',
        pendingRequest: false,
      });

      await expect(
        svc1.submit(accountId, 'MY', 'No change'),
      ).rejects.toMatchObject({
        code: 'COUNTRY_CHANGE_COUNTRY_SAME',
      });

      const { service: svc2 } = createService({
        currentCountry: 'MY',
        pendingRequest: false,
      });

      await expect(
        svc2.submit(accountId, 'MY', 'No change'),
      ).rejects.toThrow(CountryChangeError);
    });

    it('rejects when a pending request already exists', async () => {
      const { service } = createService({
        currentCountry: 'MY',
        pendingRequest: true,
      });

      await expect(
        service.submit(accountId, 'SG', 'Moving to Singapore'),
      ).rejects.toMatchObject({
        code: 'COUNTRY_CHANGE_ALREADY_PENDING',
      });
    });

    it('rejects when member is not found', async () => {
      const accountId2 = randomUUID();
      const db = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
      };

      const databaseMock = { db };
      const service = new CountryChangeService(databaseMock as unknown as DatabaseService);

      await expect(
        service.submit(accountId2, 'SG', 'Moving to Singapore'),
      ).rejects.toMatchObject({
        code: 'COUNTRY_CHANGE_MEMBER_NOT_FOUND',
      });
    });
  });

  describe('cancel', () => {
    it('cancels a pending request successfully', async () => {
      const cancelAccountId = randomUUID();
      const cancelMemberId = randomUUID();
      const requestId = randomUUID();
      const now = new Date();

      const db = {
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
      };

      // resolveMemberId
      db.limit.mockResolvedValueOnce([
        { id: cancelMemberId, accountId: cancelAccountId },
      ]);

      // find pending request
      db.limit.mockResolvedValueOnce([
        {
          id: requestId,
          memberId: cancelMemberId,
          accountId: cancelAccountId,
          currentCountry: 'MY',
          requestedCountry: 'SG',
          status: 'PENDING',
          reason: 'Moving',
          reviewedByAdminUserId: null,
          reviewReason: null,
          submittedAt: now,
          reviewedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      // return updated
      db.returning.mockResolvedValueOnce([
        {
          id: requestId,
          memberId: cancelMemberId,
          accountId: cancelAccountId,
          currentCountry: 'MY',
          requestedCountry: 'SG',
          status: 'CANCELLED',
          reason: 'Moving',
          reviewedByAdminUserId: null,
          reviewReason: null,
          submittedAt: now,
          reviewedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const databaseMock = { db };
      const service = new CountryChangeService(databaseMock as unknown as DatabaseService);

      const result = await service.cancel(cancelAccountId);
      expect(result.status).toBe('CANCELLED');
    });

    it('throws COUNTRY_CHANGE_NOT_FOUND when no pending request exists', async () => {
      const cancelAccountId = randomUUID();
      const cancelMemberId = randomUUID();

      const db = {
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
      };

      // resolveMemberId
      db.limit.mockResolvedValueOnce([
        { id: cancelMemberId, accountId: cancelAccountId },
      ]);

      // find pending request - none found
      db.limit.mockResolvedValueOnce([]);

      const databaseMock = { db };
      const service = new CountryChangeService(databaseMock as unknown as DatabaseService);

      await expect(service.cancel(cancelAccountId)).rejects.toMatchObject({
        code: 'COUNTRY_CHANGE_NOT_FOUND',
      });
    });
  });

  describe('findRequests', () => {
    it('returns pending/cancelled requests for the member', async () => {
      const findAccountId = randomUUID();
      const findMemberId = randomUUID();
      const now = new Date();

      const db = {
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
      };

      // resolveMemberId
      db.limit.mockResolvedValueOnce([
        { id: findMemberId, accountId: findAccountId },
      ]);

      // The select query result needs to return a proper mock chain
      // Override the where to return sorted results
      const mockRows = [
        {
          id: randomUUID(),
          memberId: findMemberId,
          accountId: findAccountId,
          currentCountry: 'MY',
          requestedCountry: 'SG',
          status: 'PENDING',
          reason: 'Moving',
          reviewedByAdminUserId: null,
          reviewReason: null,
          submittedAt: now,
          reviewedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ];

      const mockQuery = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn(),
      };

      // resolveMemberId needs limit(1) to resolve with member
      mockQuery.limit.mockResolvedValueOnce([
        { id: findMemberId, accountId: findAccountId },
      ]);

      // findRequests needs orderBy to resolve with results
      mockQuery.orderBy.mockResolvedValueOnce(mockRows);

      db.select.mockReturnValue(mockQuery);

      const databaseMock = { db };
      const service = new CountryChangeService(databaseMock as unknown as DatabaseService);

      const results = await service.findRequests(findAccountId);
      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe('PENDING');
      expect(results[0]?.currentCountry).toBe('MY');
      expect(results[0]?.requestedCountry).toBe('SG');
    });

    it('returns empty array when no requests exist', async () => {
      const findAccountId = randomUUID();
      const findMemberId = randomUUID();

      const db = {
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
      };

      // resolveMemberId
      db.limit.mockResolvedValueOnce([
        { id: findMemberId, accountId: findAccountId },
      ]);

const mockQuery = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn(),
      };

      // resolveMemberId needs limit(1) to resolve with member
      mockQuery.limit.mockResolvedValueOnce([
        { id: findMemberId, accountId: findAccountId },
      ]);

      // findRequests needs orderBy to resolve with empty results
      mockQuery.orderBy.mockResolvedValueOnce([]);

      db.select.mockReturnValue(mockQuery);

      const databaseMock = { db };
      const service = new CountryChangeService(databaseMock as unknown as DatabaseService);

      const results = await service.findRequests(findAccountId);
      expect(results).toHaveLength(0);
    });
  });
});


