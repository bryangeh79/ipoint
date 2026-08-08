import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  adFeeConfigs,
  adPlacements,
  ads,
  adsContentIdempotencyKeys,
  contentArticles,
  type Database,
} from '@ipoint/database';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { MarketService } from '../market/market.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  AdsContentListQueryDto,
  CreateAdDto,
  CreateArticleDto,
  CreatePlacementDto,
  TransitionDto,
  UpdateAdDto,
  UpdateArticleDto,
} from './ads-content.dto.js';
import {
  AdsContentError,
  type AdminListResponse,
  type AdsContentActor,
  type AdsContentStatus,
  type MemberHomeContentResponse,
} from './ads-content.types.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type JsonObject = Record<string, unknown>;

const TRANSITIONS: Record<AdsContentStatus, readonly AdsContentStatus[]> = {
  DRAFT: ['SCHEDULED', 'ACTIVE', 'ARCHIVED'],
  SCHEDULED: ['DRAFT', 'ACTIVE', 'EXPIRED', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'EXPIRED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'EXPIRED', 'ARCHIVED'],
  EXPIRED: ['ARCHIVED'],
  ARCHIVED: [],
};

@Injectable()
export class AdsContentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MarketService) private readonly market: MarketService,
  ) {}

  async listPlacements(actor: AdsContentActor, marketId: string) {
    this.assertMarket(actor, marketId);
    const result = await this.database.pool.query(
      `SELECT id, market_id, code, name, description, position, status,
              version, created_at, updated_at, archived_at
         FROM ad_placements
        WHERE market_id = $1
        ORDER BY position, lower(name), id`,
      [marketId],
    );
    return { market_id: marketId, items: result.rows };
  }

  async createPlacement(
    actor: AdsContentActor,
    marketId: string,
    input: CreatePlacementDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      'placement.create',
      key,
      input,
      async (tx) => {
        const rows = await tx
          .insert(adPlacements)
          .values({
            marketId,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            position: input.position,
            createdByAdminUserId: actor.adminUserId,
            updatedByAdminUserId: actor.adminUserId,
          })
          .returning();
        const row = required(rows[0]);
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: actor.adminUserId },
          action: 'ads.placement.created',
          entity: { type: 'ad_placement', id: row.id },
          marketId,
          after: row,
          reason: input.reason,
          result: 'SUCCESS',
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          summary: `Ad placement ${input.code} created.`,
        });
        return placementDto(row);
      },
    );
  }

  async listAds(
    actor: AdsContentActor,
    marketId: string,
    query: AdsContentListQueryDto,
  ): Promise<AdminListResponse<JsonObject>> {
    this.assertMarket(actor, marketId);
    const values: unknown[] = [marketId];
    const where = ['a.market_id = $1'];
    if (query.status) {
      values.push(query.status);
      where.push(`a.status = $${values.length}`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      where.push(
        `(a.title ILIKE $${values.length} OR coalesce(a.summary, '') ILIKE $${values.length})`,
      );
    }
    values.push(query.limit, query.offset);
    const result = await this.database.pool.query(
      `SELECT a.*, p.code AS placement_code, p.name AS placement_name,
              count(*) OVER()::int AS full_count
         FROM ads a
         JOIN ad_placements p ON p.id = a.placement_id AND p.market_id = a.market_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.updated_at DESC, a.id
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const rows = result.rows as unknown as JsonObject[];
    const items = rows.map(withoutFullCount);
    return {
      market_id: marketId,
      items,
      total: Number(rows[0]?.['full_count'] ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getAd(actor: AdsContentActor, marketId: string, adId: string) {
    this.assertMarket(actor, marketId);
    return this.adById(marketId, adId);
  }

  async createAd(
    actor: AdsContentActor,
    marketId: string,
    input: CreateAdDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    this.assertWindow(input.scheduleStartAt, input.scheduleEndAt);
    return this.withIdempotency(
      actor,
      marketId,
      'ad.create',
      key,
      input,
      async (tx) => {
        await this.assertPlacement(tx, marketId, input.placementId);
        await this.assertFeeConfig(tx, marketId, input.feeConfigId);
        const rows = await tx
          .insert(ads)
          .values({
            marketId,
            placementId: input.placementId,
            feeConfigId: input.feeConfigId ?? null,
            title: input.title,
            summary: input.summary ?? null,
            creativeMediaUrl: input.creativeMediaUrl,
            creativeAltText: input.creativeAltText,
            targetUrl: input.targetUrl ?? null,
            isSponsored: true,
            sponsorLabel: input.sponsorLabel,
            scheduleStartAt: toDate(input.scheduleStartAt),
            scheduleEndAt: toDate(input.scheduleEndAt),
            createdByAdminUserId: actor.adminUserId,
            updatedByAdminUserId: actor.adminUserId,
          })
          .returning();
        const row = required(rows[0]);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'ads.ad.created',
          'ad',
          row.id,
          null,
          row,
          input.reason,
        );
        return adDto(row);
      },
    );
  }

  async updateAd(
    actor: AdsContentActor,
    marketId: string,
    adId: string,
    input: UpdateAdDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `ad.update:${adId}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockAd(tx, marketId, adId);
        this.assertMutable(current.status as AdsContentStatus);
        if (Number(current.version) !== input.expectedVersion)
          this.stale(input.expectedVersion, current.version);
        if (input.placementId)
          await this.assertPlacement(tx, marketId, input.placementId);
        if (input.feeConfigId !== undefined)
          await this.assertFeeConfig(tx, marketId, input.feeConfigId);
        const scheduleStart =
          input.scheduleStartAt === undefined
            ? toDate(
                current.scheduleStartAt as string | Date | null | undefined,
              )
            : toDate(input.scheduleStartAt);
        const scheduleEnd =
          input.scheduleEndAt === undefined
            ? toDate(current.scheduleEndAt as string | Date | null | undefined)
            : toDate(input.scheduleEndAt);
        this.assertWindow(scheduleStart, scheduleEnd);
        const changes: Partial<typeof ads.$inferInsert> = {
          updatedByAdminUserId: actor.adminUserId,
          updatedAt: new Date(),
          version: input.expectedVersion + 1,
        };
        if (input.placementId !== undefined)
          changes.placementId = input.placementId;
        if (input.feeConfigId !== undefined)
          changes.feeConfigId = input.feeConfigId;
        if (input.title !== undefined) changes.title = input.title;
        if (input.summary !== undefined) changes.summary = input.summary;
        if (input.creativeMediaUrl !== undefined)
          changes.creativeMediaUrl = input.creativeMediaUrl;
        if (input.creativeAltText !== undefined)
          changes.creativeAltText = input.creativeAltText;
        if (input.targetUrl !== undefined) changes.targetUrl = input.targetUrl;
        if (input.sponsorLabel !== undefined)
          changes.sponsorLabel = input.sponsorLabel;
        if (input.scheduleStartAt !== undefined)
          changes.scheduleStartAt = scheduleStart;
        if (input.scheduleEndAt !== undefined)
          changes.scheduleEndAt = scheduleEnd;
        const rows = await tx
          .update(ads)
          .set(changes)
          .where(
            and(
              eq(ads.id, adId),
              eq(ads.marketId, marketId),
              eq(ads.version, input.expectedVersion),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(input.expectedVersion, current.version);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'ads.ad.updated',
          'ad',
          adId,
          current,
          updated,
          input.reason,
        );
        return adDto(required(updated));
      },
    );
  }

  async transitionAd(
    actor: AdsContentActor,
    marketId: string,
    adId: string,
    input: TransitionDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.transitionEntity(actor, marketId, 'ad', adId, input, key);
  }

  async listArticles(
    actor: AdsContentActor,
    marketId: string,
    query: AdsContentListQueryDto,
  ): Promise<AdminListResponse<JsonObject>> {
    this.assertMarket(actor, marketId);
    const values: unknown[] = [marketId];
    const where = ['market_id = $1'];
    if (query.status) {
      values.push(query.status);
      where.push(`status = $${values.length}`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      where.push(
        `(title ILIKE $${values.length} OR excerpt ILIKE $${values.length})`,
      );
    }
    values.push(query.limit, query.offset);
    const result = await this.database.pool.query(
      `SELECT *, count(*) OVER()::int AS full_count FROM content_articles
        WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const rows = result.rows as unknown as JsonObject[];
    const items = rows.map(withoutFullCount);
    return {
      market_id: marketId,
      items,
      total: Number(rows[0]?.['full_count'] ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getArticle(
    actor: AdsContentActor,
    marketId: string,
    articleId: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.articleById(marketId, articleId);
  }

  async createArticle(
    actor: AdsContentActor,
    marketId: string,
    input: CreateArticleDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    this.assertWindow(input.publishAt, input.unpublishAt);
    return this.withIdempotency(
      actor,
      marketId,
      'article.create',
      key,
      input,
      async (tx) => {
        const rows = await tx
          .insert(contentArticles)
          .values({
            marketId,
            slug: input.slug,
            title: input.title,
            excerpt: input.excerpt,
            body: input.body,
            coverMediaUrl: input.coverMediaUrl ?? null,
            coverAltText: input.coverAltText ?? null,
            isPromoted: input.isPromoted,
            sponsorLabel: input.sponsorLabel ?? null,
            publishAt: toDate(input.publishAt),
            unpublishAt: toDate(input.unpublishAt),
            authorAdminUserId: actor.adminUserId,
            updatedByAdminUserId: actor.adminUserId,
          })
          .returning();
        const row = required(rows[0]);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'content.article.created',
          'content_article',
          row.id,
          null,
          row,
          input.reason,
        );
        return articleDto(row);
      },
    );
  }

  async updateArticle(
    actor: AdsContentActor,
    marketId: string,
    articleId: string,
    input: UpdateArticleDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `article.update:${articleId}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockArticle(tx, marketId, articleId);
        this.assertMutable(current.status as AdsContentStatus);
        if (Number(current.version) !== input.expectedVersion)
          this.stale(input.expectedVersion, current.version);
        const publishAt =
          input.publishAt === undefined
            ? toDate(current.publishAt as string | Date | null | undefined)
            : toDate(input.publishAt);
        const unpublishAt =
          input.unpublishAt === undefined
            ? toDate(current.unpublishAt as string | Date | null | undefined)
            : toDate(input.unpublishAt);
        this.assertWindow(publishAt, unpublishAt);
        const promoted = input.isPromoted ?? current.isPromoted;
        const label =
          input.sponsorLabel === undefined
            ? current.sponsorLabel
            : input.sponsorLabel;
        if (promoted && !label)
          throw new AdsContentError(
            'ADS_CONTENT_INVALID_CONTENT',
            'Promoted content requires a sponsor label.',
          );
        const coverUrl =
          input.coverMediaUrl === undefined
            ? current.coverMediaUrl
            : input.coverMediaUrl;
        const coverAlt =
          input.coverAltText === undefined
            ? current.coverAltText
            : input.coverAltText;
        if (coverUrl && !coverAlt)
          throw new AdsContentError(
            'ADS_CONTENT_INVALID_CONTENT',
            'Cover media requires alternative text.',
          );
        const changes: Partial<typeof contentArticles.$inferInsert> = {
          updatedByAdminUserId: actor.adminUserId,
          updatedAt: new Date(),
          version: input.expectedVersion + 1,
        };
        for (const [keyName, value] of Object.entries(input)) {
          if (
            ['expectedVersion', 'reason', 'publishAt', 'unpublishAt'].includes(
              keyName,
            ) ||
            value === undefined
          )
            continue;
          (changes as JsonObject)[keyName] = value;
        }
        if (input.publishAt !== undefined) changes.publishAt = publishAt;
        if (input.unpublishAt !== undefined) changes.unpublishAt = unpublishAt;
        const rows = await tx
          .update(contentArticles)
          .set(changes)
          .where(
            and(
              eq(contentArticles.id, articleId),
              eq(contentArticles.marketId, marketId),
              eq(contentArticles.version, input.expectedVersion),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(input.expectedVersion, current.version);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'content.article.updated',
          'content_article',
          articleId,
          current,
          updated,
          input.reason,
        );
        return articleDto(required(updated));
      },
    );
  }

  async transitionArticle(
    actor: AdsContentActor,
    marketId: string,
    articleId: string,
    input: TransitionDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.transitionEntity(
      actor,
      marketId,
      'article',
      articleId,
      input,
      key,
    );
  }

  async memberHome(accountId: string): Promise<MemberHomeContentResponse> {
    const context = await this.market.getMarket(accountId);
    const marketId = context.currentMarket.id;
    const [adRows, articleRows] = await Promise.all([
      this.database.pool.query(
        `SELECT a.public_id, p.code AS placement_code, a.title, a.summary,
                a.creative_media_url, a.creative_alt_text, a.target_url,
                true AS is_sponsored, a.sponsor_label
           FROM ads a
           JOIN ad_placements p ON p.id = a.placement_id AND p.market_id = a.market_id
          WHERE a.market_id = $1 AND a.status = 'ACTIVE'
            AND a.archived_at IS NULL AND p.status = 'ACTIVE' AND p.archived_at IS NULL
            AND (a.schedule_start_at IS NULL OR a.schedule_start_at <= now())
            AND (a.schedule_end_at IS NULL OR a.schedule_end_at > now())
          ORDER BY p.position, a.updated_at DESC, a.id`,
        [marketId],
      ),
      this.database.pool.query(
        `SELECT public_id, slug, title, excerpt, body, cover_media_url,
                cover_alt_text, is_promoted, sponsor_label,
                publish_at AS published_at
           FROM content_articles
          WHERE market_id = $1 AND status = 'ACTIVE' AND archived_at IS NULL
            AND (publish_at IS NULL OR publish_at <= now())
            AND (unpublish_at IS NULL OR unpublish_at > now())
          ORDER BY coalesce(publish_at, created_at) DESC, id`,
        [marketId],
      ),
    ]);
    return {
      market_id: marketId,
      as_of: new Date().toISOString(),
      ads: adRows.rows as MemberHomeContentResponse['ads'],
      articles: articleRows.rows as MemberHomeContentResponse['articles'],
    };
  }

  private async transitionEntity(
    actor: AdsContentActor,
    marketId: string,
    kind: 'ad' | 'article',
    id: string,
    input: TransitionDto,
    key: string,
  ) {
    return this.withIdempotency(
      actor,
      marketId,
      `${kind}.transition:${id}`,
      key,
      input,
      async (tx) => {
        const current =
          kind === 'ad'
            ? await this.lockAd(tx, marketId, id)
            : await this.lockArticle(tx, marketId, id);
        if (Number(current.version) !== input.expectedVersion)
          this.stale(input.expectedVersion, current.version);
        const from = current.status as AdsContentStatus;
        if (!TRANSITIONS[from].includes(input.status)) {
          throw new AdsContentError(
            'ADS_CONTENT_INVALID_TRANSITION',
            `Transition ${from} -> ${input.status} is not allowed.`,
            { from, to: input.status },
          );
        }
        const start =
          kind === 'ad' ? current.scheduleStartAt : current.publishAt;
        const end = kind === 'ad' ? current.scheduleEndAt : current.unpublishAt;
        this.assertTransitionSchedule(input.status, start, end);
        const now = new Date();
        const common = {
          status: input.status,
          version: input.expectedVersion + 1,
          updatedByAdminUserId: actor.adminUserId,
          updatedAt: now,
          archivedAt: input.status === 'ARCHIVED' ? now : null,
        };
        const rows =
          kind === 'ad'
            ? await tx
                .update(ads)
                .set(common)
                .where(
                  and(
                    eq(ads.id, id),
                    eq(ads.marketId, marketId),
                    eq(ads.version, input.expectedVersion),
                  ),
                )
                .returning()
            : await tx
                .update(contentArticles)
                .set(common)
                .where(
                  and(
                    eq(contentArticles.id, id),
                    eq(contentArticles.marketId, marketId),
                    eq(contentArticles.version, input.expectedVersion),
                  ),
                )
                .returning();
        const updated = rows[0];
        if (!updated) this.stale(input.expectedVersion, current.version);
        const action =
          kind === 'ad'
            ? 'ads.ad.status_changed'
            : 'content.article.status_changed';
        await this.writeAudit(
          tx,
          actor,
          marketId,
          action,
          kind === 'ad' ? 'ad' : 'content_article',
          id,
          current,
          updated,
          input.reason,
        );
        return kind === 'ad'
          ? adDto(required(updated as typeof ads.$inferSelect | undefined))
          : articleDto(
              required(
                updated as typeof contentArticles.$inferSelect | undefined,
              ),
            );
      },
    );
  }

  private async withIdempotency<T extends JsonObject>(
    actor: AdsContentActor,
    marketId: string,
    operation: string,
    key: string,
    payload: unknown,
    handler: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    if (!key || key.length > 200)
      throw new AdsContentError(
        'ADS_CONTENT_IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    const requestHash = hash(payload);
    try {
      return await this.database.db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(adsContentIdempotencyKeys)
          .where(
            and(
              eq(adsContentIdempotencyKeys.adminUserId, actor.adminUserId),
              eq(adsContentIdempotencyKeys.marketId, marketId),
              eq(adsContentIdempotencyKeys.operation, operation),
              eq(adsContentIdempotencyKeys.key, key),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (existing) {
          if (existing.requestHash !== requestHash || !existing.response)
            this.idempotencyConflict();
          return existing.response as T;
        }
        await tx.insert(adsContentIdempotencyKeys).values({
          adminUserId: actor.adminUserId,
          marketId,
          operation,
          key,
          requestHash,
        });
        const response = await handler(tx);
        await tx
          .update(adsContentIdempotencyKeys)
          .set({ response, statusCode: 200, updatedAt: new Date() })
          .where(
            and(
              eq(adsContentIdempotencyKeys.adminUserId, actor.adminUserId),
              eq(adsContentIdempotencyKeys.marketId, marketId),
              eq(adsContentIdempotencyKeys.operation, operation),
              eq(adsContentIdempotencyKeys.key, key),
            ),
          );
        return response;
      });
    } catch (error) {
      if (error instanceof AdsContentError) throw error;
      if (databaseCode(error) !== '23505') throw error;
      const rows = await this.database.db
        .select()
        .from(adsContentIdempotencyKeys)
        .where(
          and(
            eq(adsContentIdempotencyKeys.adminUserId, actor.adminUserId),
            eq(adsContentIdempotencyKeys.marketId, marketId),
            eq(adsContentIdempotencyKeys.operation, operation),
            eq(adsContentIdempotencyKeys.key, key),
          ),
        )
        .limit(1);
      const existing = rows[0];
      if (existing?.requestHash === requestHash && existing.response)
        return existing.response as T;
      if (existing) this.idempotencyConflict();
      throw new AdsContentError(
        'ADS_CONTENT_DUPLICATE',
        'A record with the same market-scoped identifier already exists.',
      );
    }
  }

  private async lockAd(tx: DatabaseTransaction, marketId: string, id: string) {
    const result = await tx.execute(
      sql`SELECT * FROM ads WHERE id = ${safeUuid(id)}::uuid AND market_id = ${safeUuid(marketId)}::uuid FOR UPDATE`,
    );
    const row = result.rows[0] as unknown as
      | Record<string, unknown>
      | undefined;
    if (!row) this.notFound();
    return camelize(row);
  }

  private async lockArticle(
    tx: DatabaseTransaction,
    marketId: string,
    id: string,
  ) {
    const result = await tx.execute(
      sql`SELECT * FROM content_articles WHERE id = ${safeUuid(id)}::uuid AND market_id = ${safeUuid(marketId)}::uuid FOR UPDATE`,
    );
    const row = result.rows[0] as unknown as
      | Record<string, unknown>
      | undefined;
    if (!row) this.notFound();
    return camelize(row);
  }

  private async adById(marketId: string, id: string) {
    const result = await this.database.pool.query(
      `SELECT a.*, p.code AS placement_code, p.name AS placement_name
         FROM ads a JOIN ad_placements p ON p.id = a.placement_id AND p.market_id = a.market_id
        WHERE a.market_id = $1 AND (a.id::text = $2 OR a.public_id::text = $2)`,
      [marketId, id],
    );
    if (!result.rows[0]) {
      const foreign = await this.database.pool.query(
        'SELECT 1 FROM ads WHERE id::text = $1 OR public_id::text = $1 LIMIT 1',
        [id],
      );
      if (foreign.rows[0])
        throw new AdsContentError(
          'ADS_CONTENT_MARKET_MISMATCH',
          'The ad belongs to another market.',
        );
      this.notFound();
    }
    return result.rows[0] as JsonObject;
  }

  private async articleById(marketId: string, id: string) {
    const result = await this.database.pool.query(
      `SELECT * FROM content_articles WHERE market_id = $1 AND (id::text = $2 OR public_id::text = $2 OR slug = $2)`,
      [marketId, id],
    );
    if (!result.rows[0]) {
      const foreign = await this.database.pool.query(
        'SELECT 1 FROM content_articles WHERE id::text = $1 OR public_id::text = $1 OR slug = $1 LIMIT 1',
        [id],
      );
      if (foreign.rows[0])
        throw new AdsContentError(
          'ADS_CONTENT_MARKET_MISMATCH',
          'The article belongs to another market.',
        );
      this.notFound();
    }
    return result.rows[0] as JsonObject;
  }

  private async assertPlacement(
    tx: DatabaseTransaction,
    marketId: string,
    placementId: string,
  ) {
    const rows = await tx
      .select({ id: adPlacements.id, status: adPlacements.status })
      .from(adPlacements)
      .where(
        and(
          eq(adPlacements.id, placementId),
          eq(adPlacements.marketId, marketId),
        ),
      )
      .limit(1);
    if (!rows[0] || rows[0].status !== 'ACTIVE')
      throw new AdsContentError(
        'ADS_CONTENT_PLACEMENT_INACTIVE',
        'The placement is unavailable in the selected market.',
      );
  }

  private async assertFeeConfig(
    tx: DatabaseTransaction,
    marketId: string,
    feeConfigId: string | null | undefined,
  ) {
    if (!feeConfigId) return;
    const rows = await tx
      .select({ id: adFeeConfigs.id, status: adFeeConfigs.status })
      .from(adFeeConfigs)
      .where(
        and(
          eq(adFeeConfigs.id, feeConfigId),
          eq(adFeeConfigs.marketId, marketId),
        ),
      )
      .limit(1);
    if (!rows[0] || rows[0].status === 'ARCHIVED')
      throw new AdsContentError(
        'ADS_CONTENT_FEE_CONFIG_UNAVAILABLE',
        'The advertisement fee configuration is unavailable in this market.',
      );
  }

  private assertMarket(actor: AdsContentActor, marketId: string) {
    if (!actor.currentMarketId || actor.currentMarketId !== marketId) {
      throw new AdsContentError(
        'ADS_CONTENT_MARKET_MISMATCH',
        'The resource market must equal the server Current Admin Market.',
      );
    }
  }

  private assertWindow(
    start: string | Date | null | undefined,
    end: string | Date | null | undefined,
  ) {
    const startDate = toDate(start);
    const endDate = toDate(end);
    if (endDate && (!startDate || endDate <= startDate))
      throw new AdsContentError(
        'ADS_CONTENT_INVALID_SCHEDULE',
        'The end time must be later than the start time.',
      );
  }

  private assertTransitionSchedule(
    status: AdsContentStatus,
    start: unknown,
    end: unknown,
  ) {
    const now = new Date();
    const startDate = toDate(start as string | Date | null | undefined);
    const endDate = toDate(end as string | Date | null | undefined);
    this.assertWindow(startDate, endDate);
    if (status === 'SCHEDULED' && (!startDate || startDate <= now))
      throw new AdsContentError(
        'ADS_CONTENT_INVALID_SCHEDULE',
        'Scheduled items require a future start time.',
      );
    if (
      status === 'ACTIVE' &&
      ((startDate && startDate > now) || (endDate && endDate <= now))
    )
      throw new AdsContentError(
        'ADS_CONTENT_INVALID_SCHEDULE',
        'Active items must be inside their publication window.',
      );
    if (status === 'EXPIRED' && (!endDate || endDate > now))
      throw new AdsContentError(
        'ADS_CONTENT_INVALID_SCHEDULE',
        'Items can expire only after their configured end time.',
      );
  }

  private assertMutable(status: AdsContentStatus) {
    if (status === 'ARCHIVED')
      throw new AdsContentError(
        'ADS_CONTENT_INVALID_TRANSITION',
        'Archived records are immutable.',
      );
  }

  private stale(expected: number, actual: unknown): never {
    throw new AdsContentError(
      'ADS_CONTENT_STALE_VERSION',
      'The record changed. Refresh and retry.',
      { expected, actual },
    );
  }

  private idempotencyConflict(): never {
    throw new AdsContentError(
      'ADS_CONTENT_IDEMPOTENCY_CONFLICT',
      'The idempotency key was reused with a different payload.',
    );
  }

  private notFound(): never {
    throw new AdsContentError(
      'ADS_CONTENT_NOT_FOUND',
      'The selected-market record was not found.',
    );
  }

  private async writeAudit(
    tx: DatabaseTransaction,
    actor: AdsContentActor,
    marketId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    reason: string,
  ) {
    await this.audit.appendWithinTransaction(tx, {
      actor: { type: 'ADMIN_USER', id: actor.adminUserId },
      action,
      entity: { type: entityType, id: entityId },
      marketId,
      before,
      after,
      reason,
      result: 'SUCCESS',
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      summary: `${entityType} privileged operation completed.`,
    });
  }
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function required<T>(value: T | undefined): T {
  if (!value) throw new Error('Expected database row.');
  return value;
}
function toDate(value: string | Date | null | undefined): Date | null {
  return value == null ? null : value instanceof Date ? value : new Date(value);
}
function safeUuid(value: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(value))
    throw new AdsContentError(
      'ADS_CONTENT_NOT_FOUND',
      'The record was not found.',
    );
  return value;
}
function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; cause?: unknown };
  return typeof record.code === 'string'
    ? record.code
    : databaseCode(record.cause);
}
function camelize(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/gu, (_m, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}
function withoutFullCount(row: JsonObject): JsonObject {
  const copy = { ...row };
  delete copy['full_count'];
  return copy;
}
function placementDto(row: typeof adPlacements.$inferSelect): JsonObject {
  return {
    id: row.id,
    market_id: row.marketId,
    code: row.code,
    name: row.name,
    description: row.description,
    position: row.position,
    status: row.status,
    version: row.version,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
  };
}
function adDto(row: typeof ads.$inferSelect): JsonObject {
  return {
    id: row.id,
    public_id: row.publicId,
    market_id: row.marketId,
    placement_id: row.placementId,
    fee_config_id: row.feeConfigId,
    title: row.title,
    summary: row.summary,
    creative_media_url: row.creativeMediaUrl,
    creative_alt_text: row.creativeAltText,
    target_url: row.targetUrl,
    is_sponsored: row.isSponsored,
    sponsor_label: row.sponsorLabel,
    status: row.status,
    schedule_start_at: row.scheduleStartAt?.toISOString() ?? null,
    schedule_end_at: row.scheduleEndAt?.toISOString() ?? null,
    version: row.version,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
  };
}
function articleDto(row: typeof contentArticles.$inferSelect): JsonObject {
  return {
    id: row.id,
    public_id: row.publicId,
    market_id: row.marketId,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    cover_media_url: row.coverMediaUrl,
    cover_alt_text: row.coverAltText,
    is_promoted: row.isPromoted,
    sponsor_label: row.sponsorLabel,
    status: row.status,
    publish_at: row.publishAt?.toISOString() ?? null,
    unpublish_at: row.unpublishAt?.toISOString() ?? null,
    version: row.version,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
  };
}
