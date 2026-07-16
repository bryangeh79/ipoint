import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { markets } from '@ipoint/database';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from './audit.service.js';

export interface MarketInput {
  code: string;
  name: string;
  currencyCode: string;
  timezone: string;
  defaultLocale: string;
}

export interface AdminActionContext {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
  reason?: string;
}

@Injectable()
export class MarketService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(options: { includeInactive?: boolean } = {}) {
    const rows = await this.database.db.select().from(markets);
    return options.includeInactive
      ? rows
      : rows.filter((market) => market.status === 'ACTIVE');
  }

  async create(input: MarketInput, actor: AdminActionContext) {
    const normalized = validateMarketInput(input);
    return this.database.db.transaction(async (tx) => {
      try {
        const rows = await tx
          .insert(markets)
          .values({ ...normalized, status: 'INACTIVE' })
          .returning();
        const market = rows[0];
        if (!market) throw new Error('Market insert did not return a row.');
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: actor.adminUserId },
          action: 'market.create',
          entity: { type: 'market', id: market.id },
          marketId: market.id,
          after: market,
          reason: actor.reason,
          result: 'SUCCESS',
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          summary: `Market ${market.code} created as inactive.`,
        });
        return market;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({
            code: 'MARKET_CODE_EXISTS',
            message: 'A market with this code already exists.',
          });
        }
        throw error;
      }
    });
  }

  async setStatus(
    marketId: string,
    status: 'ACTIVE' | 'INACTIVE',
    actor: AdminActionContext,
  ) {
    return this.database.db.transaction(async (tx) => {
      const before = await tx
        .select()
        .from(markets)
        .where(eq(markets.id, marketId))
        .limit(1);
      const current = before[0];
      if (!current) return null;
      const rows = await tx
        .update(markets)
        .set({ status, updatedAt: new Date() })
        .where(eq(markets.id, marketId))
        .returning();
      const market = rows[0];
      if (!market) return null;
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: status === 'ACTIVE' ? 'market.activate' : 'market.deactivate',
        entity: { type: 'market', id: market.id },
        marketId: market.id,
        before: current,
        after: market,
        reason: actor.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: `Market ${market.code} changed to ${status}.`,
      });
      return market;
    });
  }
}

export function validateMarketInput(input: MarketInput): MarketInput {
  const code = input.code.trim().toUpperCase();
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/u.test(code)) throw new Error('Invalid market code.');
  if (!/^[A-Z]{3}$/u.test(currencyCode))
    throw new Error('Invalid ISO currency code.');
  if (!input.name.trim()) throw new Error('Market name is required.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format();
  } catch {
    throw new Error('Invalid IANA timezone.');
  }
  try {
    new Intl.Locale(input.defaultLocale);
  } catch {
    throw new Error('Invalid locale.');
  }
  return {
    code,
    name: input.name.trim(),
    currencyCode,
    timezone: input.timezone,
    defaultLocale: input.defaultLocale,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const cause = 'cause' in error ? error.cause : error;
  return Boolean(
    cause &&
    typeof cause === 'object' &&
    'code' in cause &&
    cause.code === '23505',
  );
}
