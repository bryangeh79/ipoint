import { Inject, Injectable } from '@nestjs/common';
import { memberMarketPreferences, markets, members } from '@ipoint/database';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  marketNotActiveError,
  marketNotFoundError,
  marketNotEnabledError,
} from './market.errors.js';
import type { MemberMarketResponse } from './market.types.js';

@Injectable()
export class MarketService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  private async resolveMemberId(accountId: string): Promise<string> {
    const rows = await this.database.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.accountId, accountId))
      .limit(1);
    if (!rows[0]) throw marketNotFoundError();
    return rows[0].id;
  }

  async getMarket(accountId: string): Promise<MemberMarketResponse> {
    const memberId = await this.resolveMemberId(accountId);
    const prefs = await this.database.db
      .select({
        marketId: memberMarketPreferences.marketId,
        isCurrent: memberMarketPreferences.isCurrent,
        isEnabled: memberMarketPreferences.isEnabled,
        sortOrder: memberMarketPreferences.sortOrder,
        code: markets.code,
        name: markets.name,
      })
      .from(memberMarketPreferences)
      .innerJoin(markets, eq(memberMarketPreferences.marketId, markets.id))
      .where(eq(memberMarketPreferences.memberId, memberId))
      .orderBy(memberMarketPreferences.sortOrder);

    if (prefs.length === 0) {
      throw marketNotFoundError();
    }

    return {
      currentMarket: {
        id:
          prefs.filter((p) => p.isCurrent).length > 0
            ? (prefs.filter((p) => p.isCurrent)[0]?.marketId ?? '')
            : prefs[0]!.marketId,
        code:
          prefs.filter((p) => p.isCurrent).length > 0
            ? (prefs.filter((p) => p.isCurrent)[0]?.code ?? '')
            : prefs[0]!.code,
        name:
          prefs.filter((p) => p.isCurrent).length > 0
            ? (prefs.filter((p) => p.isCurrent)[0]?.name ?? '')
            : prefs[0]!.name,
        isCurrent: true,
        isEnabled: true,
        sortOrder: 0,
      },
      enabledMarkets: prefs.map((p) => ({
        id: p.marketId,
        code: p.code,
        name: p.name,
        isCurrent: p.isCurrent,
        isEnabled: p.isEnabled,
        sortOrder: p.sortOrder,
      })),
    };
  }

  async updateMarket(
    accountId: string,
    marketId: string,
  ): Promise<MemberMarketResponse> {
    const memberId = await this.resolveMemberId(accountId);

    const targetMarket = await this.database.db
      .select()
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    if (!targetMarket[0]) throw marketNotFoundError();
    if (targetMarket[0].status !== 'ACTIVE') throw marketNotActiveError();

    const pref = await this.database.db
      .select()
      .from(memberMarketPreferences)
      .where(
        and(
          eq(memberMarketPreferences.memberId, memberId),
          eq(memberMarketPreferences.marketId, marketId),
        ),
      )
      .limit(1);
    if (!pref[0]) throw marketNotEnabledError();

    await this.database.db
      .update(memberMarketPreferences)
      .set({ isCurrent: false })
      .where(
        and(
          eq(memberMarketPreferences.memberId, memberId),
          eq(memberMarketPreferences.isCurrent, true),
        ),
      );

    await this.database.db
      .update(memberMarketPreferences)
      .set({ isCurrent: true })
      .where(
        and(
          eq(memberMarketPreferences.memberId, memberId),
          eq(memberMarketPreferences.marketId, marketId),
        ),
      );

    return this.getMarket(accountId);
  }
}
