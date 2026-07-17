import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../config/config.service.js';
import type { DatabaseService } from '../database/database.service.js';
import { MarketError } from './market.types.js';
import { MarketService } from './market.service.js';

describe('MarketService', () => {
  const accountId = randomUUID();

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
      innerJoin: vi.fn().mockReturnThis(),
    };
  }

  function makeService(db: ReturnType<typeof createMockDb>) {
    const config = { defaultFallbackMarketCode: 'MY' } as ConfigService;
    return new MarketService({ db } as unknown as DatabaseService, config);
  }

  it('getMarket: throws for missing member', async () => {
    const db = createMockDb();
    db.limit.mockResolvedValueOnce([]);
    const svc = makeService(db);
    await expect(svc.getMarket(accountId)).rejects.toThrow(MarketError);
  });
});
