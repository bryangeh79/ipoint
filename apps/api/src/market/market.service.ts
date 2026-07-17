import { Inject, Injectable } from '@nestjs/common';
import {
  accounts,
  memberMarketPreferences,
  markets,
  members,
} from '@ipoint/database';
import { and, eq, sql } from 'drizzle-orm';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  marketConfigError,
  marketNotActiveError,
  marketNotEnabledError,
  marketNotFoundError,
} from './market.errors.js';
import type { MemberMarketResponse } from './market.types.js';

@Injectable()
export class MarketService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
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

  private async getAccountCountry(memberId: string): Promise<string | null> {
    const rows = await this.database.db
      .select({ accountCountry: accounts.accountCountry })
      .from(members)
      .innerJoin(accounts, eq(members.accountId, accounts.id))
      .where(eq(members.id, memberId));
    return rows[0]?.accountCountry ?? null;
  }

  private async getPreferences(
    memberId: string,
  ): Promise<MemberMarketResponse['enabledMarkets']> {
    const rows = await this.database.db
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

    return rows.map((row) => ({
      id: row.marketId,
      code: row.code,
      name: row.name,
      isCurrent: row.isCurrent,
      isEnabled: row.isEnabled,
      sortOrder: row.sortOrder,
    }));
  }

  private toResponse(
    preferences: MemberMarketResponse['enabledMarkets'],
  ): MemberMarketResponse {
    const current = preferences.find((preference) => preference.isCurrent);
    if (!current) throw marketConfigError();
    return { currentMarket: current, enabledMarkets: preferences };
  }

  private async findActiveMarketByCode(
    code: string,
  ): Promise<{ id: string } | null> {
    const rows = await this.database.db
      .select({ id: markets.id })
      .from(markets)
      .where(
        and(
          sql`upper(${markets.code}) = upper(${code})`,
          eq(markets.status, 'ACTIVE'),
        ),
      );
    return rows[0] ?? null;
  }

  async getOrInitializeCurrentMarket(
    accountId: string,
  ): Promise<MemberMarketResponse> {
    const memberId = await this.resolveMemberId(accountId);
    const existingPreferences = await this.getPreferences(memberId);
    if (existingPreferences.some((preference) => preference.isCurrent)) {
      return this.toResponse(existingPreferences);
    }

    const accountCountry = await this.getAccountCountry(memberId);
    const countryMarket = accountCountry
      ? await this.findActiveMarketByCode(accountCountry)
      : null;
    const fallbackMarket = countryMarket
      ? null
      : await this.findActiveMarketByCode(
          this.config.defaultFallbackMarketCode,
        );
    const targetMarket = countryMarket ?? fallbackMarket;
    if (!targetMarket) throw marketConfigError();

    await this.database.db
      .insert(memberMarketPreferences)
      .values({
        memberId,
        marketId: targetMarket.id,
        isEnabled: true,
        isCurrent: true,
        sortOrder: 0,
      })
      .onConflictDoNothing();

    return this.toResponse(await this.getPreferences(memberId));
  }

  async getMarket(accountId: string): Promise<MemberMarketResponse> {
    return this.getOrInitializeCurrentMarket(accountId);
  }

  async switchMarket(
    accountId: string,
    marketId: string,
  ): Promise<MemberMarketResponse> {
    const memberId = await this.resolveMemberId(accountId);

    await this.database.runTransaction(async (tx) => {
      // Every switch for a member locks the same row, serializing concurrent
      // requests before the partial unique current-market constraint is touched.
      await tx
        .select({ id: members.id })
        .from(members)
        .where(eq(members.id, memberId))
        .for('update');

      const targetMarkets = await tx
        .select({ id: markets.id, status: markets.status })
        .from(markets)
        .where(eq(markets.id, marketId));
      const targetMarket = targetMarkets[0];
      if (!targetMarket) throw marketNotFoundError();
      if (targetMarket.status !== 'ACTIVE') throw marketNotActiveError();

      const preferences = await tx
        .select({
          id: memberMarketPreferences.id,
          isEnabled: memberMarketPreferences.isEnabled,
        })
        .from(memberMarketPreferences)
        .where(
          and(
            eq(memberMarketPreferences.memberId, memberId),
            eq(memberMarketPreferences.marketId, marketId),
          ),
        );
      if (!preferences[0]?.isEnabled) throw marketNotEnabledError();

      const now = new Date();
      await tx
        .update(memberMarketPreferences)
        .set({ isCurrent: false, updatedAt: now })
        .where(
          and(
            eq(memberMarketPreferences.memberId, memberId),
            eq(memberMarketPreferences.isCurrent, true),
          ),
        );

      const updated = await tx
        .update(memberMarketPreferences)
        .set({ isCurrent: true, lastSelectedAt: now, updatedAt: now })
        .where(
          and(
            eq(memberMarketPreferences.memberId, memberId),
            eq(memberMarketPreferences.marketId, marketId),
            eq(memberMarketPreferences.isEnabled, true),
          ),
        )
        .returning({ id: memberMarketPreferences.id });
      if (!updated[0]) throw marketNotEnabledError();
    });

    return this.getOrInitializeCurrentMarket(accountId);
  }

  async updateMarket(
    accountId: string,
    marketId: string,
  ): Promise<MemberMarketResponse> {
    return this.switchMarket(accountId, marketId);
  }
}
