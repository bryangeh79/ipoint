import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  adminUsers,
  marketAccess,
  markets,
  redemptionRateMarketRules,
  type Database,
} from '@ipoint/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { RbacService } from '../platform-access/rbac.service.js';
import { RedemptionError } from './redemption.errors.js';
import {
  redemptionRateAboveMaximumError,
  redemptionRateActivationNotFutureError,
  redemptionRateAlreadyCancelledError,
  redemptionRateBelowMinimumError,
  redemptionRateCannotCancelEffectiveError,
  redemptionRateCurrencyMismatchError,
  redemptionRateIdempotencyConflictError,
  redemptionRateIdempotencyKeyRequiredError,
  redemptionRateMarketAccessDeniedError,
  redemptionRateMarketBlockedError,
  redemptionRateMarketContextMismatchError,
  redemptionRateMarketNotFoundError,
  redemptionRateMarketSelectionRequiredError,
  redemptionRateOverlapError,
  redemptionRatePermissionDeniedError,
  redemptionRatePrecisionError,
  redemptionRateReasonRequiredError,
} from './redemption.errors.js';
import type {
  RedemptionAdminActor,
  RedemptionCatalogItem,
  RedemptionCatalogListResponse,
  RedemptionRateVersion,
  RedemptionRateVersionListItem,
  RedemptionPickupLocation,
  RedemptionPickupLocationListItem,
  RedemptionQuote,
  ShippingCostResponse,
  ItemDetailResponse,
  MemberCatalogListResponse,
  RedemptionOrderResponse,
  ConfirmOrderInput,
  CreateRateVersionCommand,
  CancelRateVersionCommand,
  RedemptionRateVersionCreateResponse,
  RedemptionRateCancelResponse,
  RedemptionRateMarketConfig,
} from './redemption.types.js';
import type {
  ShippingPaymentAdapter,
  PaymentIntentRequest,
} from './shipping-payment.port.js';
import { SHIPPING_PAYMENT_ADAPTER } from './shipping-payment.port.js';

/**
 * Redemption Service — P6-S2/S3/S4
 *
 * Implements:
 * - Admin catalog CRUD (P6-S2)
 * - Member catalog browse & item detail (P6-S2)
 * - Rate version management (P6-S2)
 * - Pickup location CRUD (P6-S2)
 * - Quote generation with rate conversion pricing (OD-21) and rate lock (OD-22) (P6-S3)
 * - Shipping cost calculation & payment integration (OD-07) (P6-S3)
 * - Fiat payment adapter with sandbox implementation (P6-S3)
 * - Atomic order confirm with Direct Atomic Debit (P6-S4)
 *
 * Uses raw SQL to target the canonical Phase 6 schema tables.
 * Canonical schema defined in packages/database/schema/redemption.ts.
 */

/**
 * D-053 §6 technical precision: at most ten decimals.
 */
export const REDEMPTION_RATE_SCALE = 10n ** 10n;

/**
 * Owner idempotency scope namespaces (shared mechanism table
 * merchant_api_idempotency_keys, unique (scope, key)) — D-053 §10.
 */
const REDEMPTION_RATE_OWNER_CREATE_SCOPE = 'redemption.rate.owner.create';
const REDEMPTION_RATE_OWNER_CANCEL_SCOPE = 'redemption.rate.owner.cancel';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbExecutor = Database | DbTransaction;
type RedemptionRateTypeValue = 'POINTS_PER_CURRENCY' | 'CURRENCY_PER_POINT';

@Injectable()
export class RedemptionService {
  private readonly logger = new Logger(RedemptionService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SHIPPING_PAYMENT_ADAPTER)
    private readonly paymentAdapter: ShippingPaymentAdapter,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ═════════════════════════════════════════════════════════════════════════
  // ADMIN: Catalog CRUD (P6-S2) — Canonical Schema
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Create a new catalog item (admin only).
   * Canonical columns: market_id, sku, name, description, item_type, ownership,
   *   status (default DRAFT), fiat_reference_value, fiat_currency,
   *   fulfilment_mode, inventory_mode, image_url, terms, is_featured, tags,
   *   sort_order, effective_from, effective_until, created_by
   * No total_inventory (separate redemption_inventory table).
   */
  async createCatalogItem(
    actor: RedemptionAdminActor,
    input: {
      marketId: string;
      sku?: string;
      name: string;
      description?: string;
      itemType: string;
      fiatReferenceValue: string;
      fiatCurrency: string;
      fulfilmentMode?: string;
      inventoryMode: string;
      imageUrl?: string;
      terms?: string;
      isFeatured?: boolean;
      tags?: string[];
      sortOrder?: number;
      effectiveFrom?: string;
      effectiveUntil?: string;
      idempotencyKey: string;
    },
  ): Promise<RedemptionCatalogItem> {
    const db = this.database.db;

    // Check SKU uniqueness within market (canonical: uq_catalog_sku_market WHERE sku IS NOT NULL)
    if (input.sku) {
      const existing = await db.execute(
        sql`SELECT id FROM redemption_catalog_items
            WHERE market_id = ${input.marketId} AND sku = ${input.sku}`,
      );
      if (existing.rows.length > 0) {
        throw new RedemptionError(
          'REDEMPTION_CATALOG_SKU_DUPLICATE',
          `SKU "${input.sku}" already exists in this market.`,
          { marketId: input.marketId, sku: input.sku },
        );
      }
    }

    const effectiveFrom = input.effectiveFrom ?? new Date().toISOString();
    const fiatCurrency = input.fiatCurrency || 'MYR';

    const result = await db.execute(
      sql`INSERT INTO redemption_catalog_items (
          market_id, sku, name, description, item_type, ownership,
          status, fiat_reference_value, fiat_currency,
          fulfilment_mode, inventory_mode,
          image_url, terms, is_featured, tags, sort_order,
          effective_from, effective_until, created_by
        ) VALUES (
          ${input.marketId}, ${input.sku ?? null}, ${input.name},
          ${input.description ?? null}, ${input.itemType}::redemption_item_type, 'PLATFORM_OWNED'::redemption_ownership,
          'DRAFT'::redemption_catalog_status,
          ${input.fiatReferenceValue}, ${fiatCurrency},
          ${input.fulfilmentMode ?? 'DELIVERY'}::redemption_fulfilment_mode, ${input.inventoryMode}::redemption_inventory_mode,
          ${input.imageUrl ?? null}, ${input.terms ?? null},
          ${input.isFeatured ?? false},
          ${input.tags && input.tags.length > 0 ? `{${input.tags.map((t) => `"${t.replace(/"/g, '"')}"`).join(',')}}` : '{}'}::text[],
          ${input.sortOrder ?? 0},
          ${effectiveFrom}, ${input.effectiveUntil ?? null}, ${actor.adminUserId}
        ) RETURNING *`,
    );
    const created = result.rows[0];
    if (!created)
      throw new RedemptionError(
        'REDEMPTION_CATALOG_CREATE_FAILED',
        'Failed to create catalog item',
      );
    return this.toCatalogItem(created);
  }

  /**
   * Update catalog item details (admin only).
   * Uses version-based optimistic locking (canonical: version column).
   */
  async updateCatalogItem(
    actor: RedemptionAdminActor,
    itemId: string,
    input: {
      sku?: string;
      name?: string;
      description?: string;
      fiatReferenceValue?: string;
      fiatCurrency?: string;
      fulfilmentMode?: string;
      imageUrl?: string;
      terms?: string;
      isFeatured?: boolean;
      tags?: string[];
      sortOrder?: number;
      effectiveFrom?: string;
      effectiveUntil?: string;
      version: number;
      idempotencyKey: string;
    },
  ): Promise<RedemptionCatalogItem> {
    const db = this.database.db;

    // Load current item
    const existing = await db.execute(
      sql`SELECT * FROM redemption_catalog_items
          WHERE id = ${itemId}`,
    );
    const item = existing.rows[0];
    if (!item) {
      throw new RedemptionError(
        'REDEMPTION_CATALOG_ITEM_NOT_FOUND',
        'Catalog item not found.',
        { itemId },
      );
    }

    // Canonical: version-based optimistic locking
    if (Number(item.version) !== input.version) {
      throw new RedemptionError(
        'REDEMPTION_CATALOG_ITEM_VERSION_CONFLICT',
        'Item has been modified by another admin. Refresh and retry.',
        {
          itemId,
          currentVersion: Number(item.version),
          expectedVersion: input.version,
        },
      );
    }

    // If SKU is being changed, check uniqueness
    if (input.sku && input.sku !== item.sku) {
      const skuCheck = await db.execute(
        sql`SELECT id FROM redemption_catalog_items
            WHERE market_id = ${item.market_id}
              AND sku = ${input.sku}
              AND id != ${itemId}`,
      );
      if (skuCheck.rows.length > 0) {
        throw new RedemptionError(
          'REDEMPTION_CATALOG_SKU_DUPLICATE',
          `SKU "${input.sku}" already exists in this market.`,
          { marketId: item.market_id, sku: input.sku },
        );
      }
    }

    // Build dynamic SET clause with canonical column names
    const fieldMap: Record<string, unknown> = {};
    if (input.sku !== undefined) fieldMap['sku'] = input.sku;
    if (input.name !== undefined) fieldMap['name'] = input.name;
    if (input.description !== undefined)
      fieldMap['description'] = input.description;
    if (input.fiatReferenceValue !== undefined)
      fieldMap['fiat_reference_value'] = input.fiatReferenceValue;
    if (input.fiatCurrency !== undefined)
      fieldMap['fiat_currency'] = input.fiatCurrency;
    if (input.fulfilmentMode !== undefined)
      fieldMap['fulfilment_mode'] = input.fulfilmentMode;
    if (input.imageUrl !== undefined) fieldMap['image_url'] = input.imageUrl;
    if (input.terms !== undefined) fieldMap['terms'] = input.terms;
    if (input.isFeatured !== undefined)
      fieldMap['is_featured'] = input.isFeatured;
    if (input.tags !== undefined) {
      const tagsStr =
        input.tags.length > 0
          ? `{${input.tags.map((t) => `"${t.replace(/"/g, '"')}"`).join(',')}}`
          : '{}';
      fieldMap['tags'] = sql`${tagsStr}::text[]`;
    }
    if (input.sortOrder !== undefined) fieldMap['sort_order'] = input.sortOrder;
    if (input.effectiveFrom !== undefined)
      fieldMap['effective_from'] = input.effectiveFrom;
    if (input.effectiveUntil !== undefined)
      fieldMap['effective_until'] = input.effectiveUntil;

    if (Object.keys(fieldMap).length === 0) {
      throw new RedemptionError(
        'REDEMPTION_CATALOG_ITEM_NOT_FOUND',
        'No fields to update.',
        { itemId },
      );
    }

    let updateSql = sql`UPDATE redemption_catalog_items SET `;
    const entries = Object.entries(fieldMap);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const [col, val] = entry;
      if (i > 0) updateSql = sql`${updateSql}, `;
      updateSql = sql`${updateSql} ${sql.identifier(col)} = ${val}`;
    }

    updateSql = sql`${updateSql}, version = version + 1, updated_at = NOW()
      WHERE id = ${itemId} AND version = ${input.version} RETURNING *`;
    const result = await db.execute(updateSql);
    const updated = result.rows[0];
    if (!updated) {
      throw new RedemptionError(
        'REDEMPTION_CATALOG_ITEM_VERSION_CONFLICT',
        'Concurrent modification detected. Refresh and retry.',
        { itemId },
      );
    }

    return this.toCatalogItem(updated);
  }

  /**
   * Set catalog item status (admin only).
   * Canonical: uses redemption_catalog_status enum (DRAFT, ACTIVE, DISABLED, ARCHIVED).
   * Replaces old disableCatalogItem method.
   */
  async setCatalogStatus(
    _actor: RedemptionAdminActor,
    itemId: string,
    input: { status: string; reason: string; idempotencyKey: string },
  ): Promise<{ id: string; status: string }> {
    const db = this.database.db;

    // Validate status against canonical enum values
    const validStatuses = ['DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED'];
    if (!validStatuses.includes(input.status)) {
      throw new RedemptionError(
        'REDEMPTION_INVALID_STATUS',
        `Invalid status "${input.status}". Must be one of: ${validStatuses.join(', ')}`,
        { itemId, invalidStatus: input.status },
      );
    }

    const result = await db.execute(
      sql`UPDATE redemption_catalog_items
          SET status = ${input.status}::redemption_catalog_status,
              updated_at = NOW()
          WHERE id = ${itemId}
          RETURNING id, status`,
    );
    const item = result.rows[0];
    if (!item) {
      throw new RedemptionError(
        'REDEMPTION_CATALOG_ITEM_NOT_FOUND',
        'Catalog item not found.',
        { itemId },
      );
    }

    return { id: item.id as string, status: item.status as string };
  }

  /**
   * List catalog items (admin view) with optional filters.
   * Canonical: filters by status enum (not is_active boolean).
   */
  async listCatalogItems(
    _actor: RedemptionAdminActor,
    marketId: string,
    filters: {
      page: number;
      pageSize: number;
      query?: string;
      itemType?: string;
      status?: string;
      isFeatured?: boolean;
      fulfilmentMode?: string;
      sort: string;
    },
  ): Promise<RedemptionCatalogListResponse> {
    const db = this.database.db;
    const conditions: ReturnType<typeof sql>[] = [sql`market_id = ${marketId}`];

    if (filters.query) {
      const likePattern = `%${filters.query}%`;
      conditions.push(
        sql`(name ILIKE ${likePattern} OR description ILIKE ${likePattern} OR sku ILIKE ${likePattern})`,
      );
    }
    if (filters.itemType) {
      conditions.push(
        sql`item_type = ${filters.itemType}::redemption_item_type`,
      );
    }
    if (filters.status) {
      conditions.push(
        sql`status = ${filters.status}::redemption_catalog_status`,
      );
    }
    if (filters.isFeatured !== undefined) {
      conditions.push(sql`is_featured = ${filters.isFeatured}`);
    }
    if (filters.fulfilmentMode) {
      conditions.push(
        sql`fulfilment_mode = ${filters.fulfilmentMode}::redemption_fulfilment_mode`,
      );
    }

    const whereClause =
      conditions.length > 0
        ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
        : sql``;
    const offset = (filters.page - 1) * filters.pageSize;
    let orderClause = 'created_at DESC';
    switch (filters.sort) {
      case 'name:asc':
        orderClause = 'name ASC';
        break;
      case 'name:desc':
        orderClause = 'name DESC';
        break;
      case 'createdAt:asc':
        orderClause = 'created_at ASC';
        break;
      case 'sortOrder:asc':
        orderClause = 'sort_order ASC, name ASC';
        break;
    }

    const countResult = await db.execute(
      sql`SELECT COUNT(*) as total FROM redemption_catalog_items ${whereClause}`,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const listResult = await db.execute(
      sql`SELECT id, name, sku, item_type, fiat_reference_value, fiat_currency,
                 inventory_mode, fulfilment_mode, status, is_featured,
                 image_url, tags, sort_order, effective_from, effective_until, version
          FROM redemption_catalog_items ${whereClause}
          ORDER BY ${sql.raw(orderClause)}
          LIMIT ${filters.pageSize} OFFSET ${offset}`,
    );
    return {
      items: listResult.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        sku: (row.sku as string) ?? null,
        itemType: row.item_type as string,
        fiatReferenceValue: row.fiat_reference_value as string,
        fiatCurrency: row.fiat_currency as string,
        inventoryMode: row.inventory_mode as string,
        fulfilmentMode: row.fulfilment_mode as string,
        status: row.status as string,
        isFeatured: row.is_featured as boolean,
        imageUrl: (row.image_url as string) ?? null,
        tags: (row.tags as string[]) ?? [],
        sortOrder: Number(row.sort_order),
        effectiveFrom: new Date(row.effective_from as string).toISOString(),
        effectiveUntil: row.effective_until
          ? new Date(row.effective_until as string).toISOString()
          : null,
        version: Number(row.version),
      })),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  /**
   * Get catalog item detail (admin view).
   */
  async getCatalogItem(
    _actor: RedemptionAdminActor,
    itemId: string,
  ): Promise<RedemptionCatalogItem> {
    const db = this.database.db;
    const result = await db.execute(
      sql`SELECT * FROM redemption_catalog_items
          WHERE id = ${itemId}`,
    );
    const item = result.rows[0];
    if (!item) {
      throw new RedemptionError(
        'REDEMPTION_CATALOG_ITEM_NOT_FOUND',
        'Catalog item not found.',
        { itemId },
      );
    }
    return this.toCatalogItem(item);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // MEMBER: Catalog Browse & Item Detail (P6-S2)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Browse active catalog items for the member's current market.
   * Canonical: filters by status = 'ACTIVE' (not is_active boolean).
   */
  async browseCatalog(
    marketId: string,
    filters: {
      page: number;
      pageSize: number;
      query?: string;
      itemType?: string;
      fulfilmentMode?: string;
      sort: string;
    },
  ): Promise<MemberCatalogListResponse> {
    const db = this.database.db;
    const conditions: ReturnType<typeof sql>[] = [
      sql`market_id = ${marketId}`,
      sql`status = 'ACTIVE'::redemption_catalog_status`,
      sql`effective_from <= NOW()`,
      sql`(effective_until IS NULL OR effective_until > NOW())`,
    ];

    if (filters.query) {
      const likePattern = `%${filters.query}%`;
      conditions.push(
        sql`(name ILIKE ${likePattern} OR description ILIKE ${likePattern})`,
      );
    }
    if (filters.itemType) {
      conditions.push(
        sql`item_type = ${filters.itemType}::redemption_item_type`,
      );
    }
    if (filters.fulfilmentMode) {
      conditions.push(
        sql`fulfilment_mode = ${filters.fulfilmentMode}::redemption_fulfilment_mode`,
      );
    }

    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;
    const offset = (filters.page - 1) * filters.pageSize;
    let orderClause = 'sort_order ASC, name ASC';
    switch (filters.sort) {
      case 'name:asc':
        orderClause = 'name ASC';
        break;
      case 'name:desc':
        orderClause = 'name DESC';
        break;
    }

    const countResult = await db.execute(
      sql`SELECT COUNT(*) as total FROM redemption_catalog_items ${whereClause}`,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const listResult = await db.execute(
      sql`SELECT id, name, sku, item_type, fiat_reference_value, fiat_currency,
                 inventory_mode, fulfilment_mode, image_url, tags, is_featured, sort_order
          FROM redemption_catalog_items ${whereClause}
          ORDER BY ${sql.raw(orderClause)}
          LIMIT ${filters.pageSize} OFFSET ${offset}`,
    );
    return {
      items: listResult.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        sku: (row.sku as string) ?? null,
        itemType: row.item_type as string,
        fiatReferenceValue: row.fiat_reference_value as string,
        fiatCurrency: row.fiat_currency as string,
        inventoryMode: row.inventory_mode as string,
        fulfilmentMode: row.fulfilment_mode as string,
        imageUrl: (row.image_url as string) ?? null,
        tags: (row.tags as string[]) ?? [],
        isFeatured: row.is_featured as boolean,
        sortOrder: Number(row.sort_order),
      })),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  /**
   * Get item detail for member-facing view.
   * Canonical: uses status = 'ACTIVE', no archived_at.
   */
  async getItemDetail(
    marketId: string,
    itemId: string,
  ): Promise<ItemDetailResponse> {
    const db = this.database.db;
    const result = await db.execute(
      sql`SELECT id, market_id, name, description, item_type,
                 fiat_reference_value, fiat_currency, inventory_mode,
                 image_url, terms, fulfilment_mode,
                 tags, is_featured, effective_from, effective_until, version
          FROM redemption_catalog_items
          WHERE id = ${itemId}
            AND market_id = ${marketId}
            AND status = 'ACTIVE'::redemption_catalog_status
            AND effective_from <= NOW()
            AND (effective_until IS NULL OR effective_until > NOW())`,
    );
    const item = result.rows[0];
    if (!item) {
      throw new RedemptionError(
        'REDEMPTION_CATALOG_ITEM_NOT_FOUND',
        'Item not found or not available in your market.',
        { itemId, marketId },
      );
    }

    return {
      id: item.id as string,
      marketId: item.market_id as string,
      name: item.name as string,
      description: (item.description as string) ?? null,
      itemType: item.item_type as string,
      fiatReferenceValue: item.fiat_reference_value as string,
      fiatCurrency: item.fiat_currency as string,
      inventoryMode: item.inventory_mode as string,
      imageUrl: (item.image_url as string) ?? null,
      terms: (item.terms as string) ?? null,
      fulfilmentMode: item.fulfilment_mode as string,
      tags: (item.tags as string[]) ?? [],
      isFeatured: item.is_featured as boolean,
      effectiveFrom: new Date(item.effective_from as string).toISOString(),
      effectiveUntil: item.effective_until
        ? new Date(item.effective_until as string).toISOString()
        : null,
      version: Number(item.version),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // RATE VERSION MANAGEMENT (P6-S2 + D-053 secured owner) — Canonical Schema
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Secured Phase 6 redemption-rate owner create command (D-053, CG-03).
   *
   * Every control lives HERE — in the owner command layer — so the
   * canonical route AND any in-process caller (Phase 7 adapter) get
   * identical enforcement:
   *
   * 1. Identity: authenticated ADMIN_USER actor with a real adminUserId.
   * 2. Permission: `redemption.rate.manage` re-checked server-side via
   *    RbacService.isAllowed (ACTIVE admin + ACTIVE account + grant).
   * 3. Selected-market: server Current Admin Market (actor.currentMarketId)
   *    required; active market grant asserted; body market must equal the
   *    server current market (409 otherwise).
   * 4. Per-market config (§6): the market must carry an active
   *    redemption_rate_market_rules entry (Malaysia seeded; NO cross-market
   *    fallback); unconfigured markets are explicitly blocked (422).
   * 5. Exact rate contract: positive decimal, ≤10 fractional digits
   *    (BigInt math only — no JS float arithmetic), within the approved
   *    per-market [minimum, maximum] bounds; currency must match the rule.
   * 6. Activation (§7): strictly future market-local 00:00 only (IANA
   *    multi-probe resolution; same-day/backdated/non-midnight and
   *    DST-skipped/ambiguous midnights rejected); resolved UTC + local
   *    wall time + timezone returned.
   * 7. Versioning (§8): append-only open-ended versions; strictly
   *    increasing effective_from per market + rate type (half-open
   *    [start, next_start) windows); proper overlap detection replacing
   *    the degenerate expression; no UPDATE/DELETE of existing rows.
   * 8. Concurrency (§8): transaction-scoped pg_advisory_xact_lock per
   *    market (create and cancel share the lock); exactly one winner.
   * 9. Idempotency (§10): Idempotency-Key mandatory; mechanism row in
   *    merchant_api_idempotency_keys (scope create:<marketId>:<adminUserId>);
   *    canonical payload hash (sorted keys + sha256); same-key/same-payload
   *    replays the original result; same-key/different-payload → 409.
   * 10. Reason (§11): mandatory 1..500 chars, stored durably on the version
   *     row (migration 0031); legacy rows keep NULL.
   * 11. Audit (§11): owner write + idempotency claim + immutable audit in
   *     ONE transaction (atomic rollback on any failure).
   */
  async createRateVersion(
    actor: RedemptionAdminActor,
    input: CreateRateVersionCommand,
  ): Promise<RedemptionRateVersionCreateResponse> {
    // ── 1+2. Identity + permission (server-side, in-process-safe) ─────
    if (!actor?.adminUserId) throw redemptionRatePermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'redemption.rate.manage',
    });
    if (!allowed) throw redemptionRatePermissionDeniedError();

    // ── 10. Mandatory reason (blank/overlength rejected) ──────────────
    const reason = input.reason?.trim() ?? '';
    if (!reason || reason.length > 500)
      throw redemptionRateReasonRequiredError();

    // ── 9. Operation-scoped idempotency key (mandatory) ───────────────
    const idempotencyKey = input.idempotencyKey?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw redemptionRateIdempotencyKeyRequiredError();
    }

    // ── 3. Selected-market + resource-market consistency ──────────────
    const marketId = input.marketId;
    if (!marketId) throw redemptionRateMarketSelectionRequiredError();
    if (!actor.currentMarketId)
      throw redemptionRateMarketSelectionRequiredError();
    if (actor.currentMarketId !== marketId) {
      throw redemptionRateMarketContextMismatchError();
    }
    await this.assertMarketAccess(
      this.database.db,
      actor.adminUserId,
      marketId,
    );
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionRateMarketNotFoundError();

    // ── 5. Exact rate grammar (BigInt only) ───────────────────────────
    const rateValue = input.rateValue.trim();
    let rateScaled: bigint;
    try {
      rateScaled = scaledRate(rateValue); // throws on grammar/precision
    } catch {
      throw redemptionRatePrecisionError();
    }

    // ── 4. Per-market approved configuration (no fallback) ────────────
    const rule = await this.marketRuleRow(marketId, input.rateType);
    if (!rule) throw redemptionRateMarketBlockedError();
    const minimumScaled = scaledRate(rule.minimumRate);
    const maximumScaled = scaledRate(rule.maximumRate);
    if (rateScaled < minimumScaled) {
      throw redemptionRateBelowMinimumError({
        marketId,
        rateType: input.rateType,
        rateValue,
        minimum: rule.minimumRate,
      });
    }
    if (rateScaled > maximumScaled) {
      throw redemptionRateAboveMaximumError({
        marketId,
        rateType: input.rateType,
        rateValue,
        maximum: rule.maximumRate,
      });
    }
    const fiatCurrency = input.fiatCurrency?.trim().toUpperCase() ?? '';
    if (fiatCurrency !== rule.currency) {
      throw redemptionRateCurrencyMismatchError();
    }

    // ── 6. Future market-local 00:00 activation ONLY ──────────────────
    const effectiveFrom = new Date(input.effectiveFrom);
    if (
      Number.isNaN(effectiveFrom.getTime()) ||
      !isMarketLocalMidnight(effectiveFrom, market.timezone) ||
      effectiveFrom.getTime() <= Date.now()
    ) {
      throw redemptionRateActivationNotFutureError();
    }

    // ── 9. Canonical payload hash (sorted keys + sha256) ──────────────
    const payloadHash = canonicalPayloadHash({
      operation: 'create',
      marketId,
      rateType: input.rateType,
      rateValue,
      localDate: localDateString(effectiveFrom, market.timezone),
      effectiveFrom: effectiveFrom.toISOString(),
      timezone: market.timezone,
      reason,
      actorScope: `${REDEMPTION_RATE_OWNER_CREATE_SCOPE}:${marketId}:${actor.adminUserId}`,
    });

    const scope = `${REDEMPTION_RATE_OWNER_CREATE_SCOPE}:${marketId}:${actor.adminUserId}`;
    const lockKey = this.ownerLockKey(marketId);

    // ── 7/8/9/11: atomic create with lock, chain, idempotency, audit ──
    return this.database.runTransaction(async (tx) => {
      // 8. Serialize the whole operation per market scope. Transaction-
      // scoped lock: auto-releases at commit/rollback; a losing concurrent
      // command waits, then observes the winner's row and fails the chain
      // rule (deterministic result).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      // 9. Claim the operation key. On conflict the row already exists
      // (replay path); on any later throw the claim rolls back with the
      // transaction so the same key can be retried after correction.
      const claimed = await tx.execute(
        sql`INSERT INTO merchant_api_idempotency_keys (scope, key, request_hash)
            VALUES (${scope}, ${idempotencyKey}, ${payloadHash})
            ON CONFLICT (scope, key) DO NOTHING
            RETURNING id`,
      );
      const claimRow = claimed.rows[0];

      if (!claimRow) {
        const existing = await tx.execute(
          sql`SELECT id, response, status_code, request_hash
              FROM merchant_api_idempotency_keys
              WHERE scope = ${scope} AND key = ${idempotencyKey}
              LIMIT 1`,
        );
        const row = existing.rows[0];
        // Same key + different payload → conflict; otherwise replay the
        // original result exactly.
        if (!row || row.response === null || row.request_hash !== payloadHash) {
          throw redemptionRateIdempotencyConflictError();
        }
        return row.response as unknown as RedemptionRateVersionCreateResponse;
      }

      // 7. Chain rule (proper overlap detection, D-050 pattern): the new
      // version must not fall inside any existing non-cancelled window.
      // Windows are half-open [start, next_start) — ends are derived from
      // the next start, so the check reduces to the latest non-cancelled
      // version (legacy rows with a stored effective_until are respected:
      // a successor may start exactly at the predecessor's stored end).
      const latest = await tx.execute(
        sql`SELECT id, effective_from, effective_until
            FROM redemption_rate_versions
            WHERE market_id = ${marketId}
              AND rate_type = ${input.rateType}::redemption_rate_type
              AND NOT EXISTS (
                SELECT 1 FROM redemption_rate_cancellations c
                WHERE c.rate_version_id = redemption_rate_versions.id
              )
            ORDER BY effective_from DESC
            LIMIT 1`,
      );
      const latestRow = latest.rows[0];
      if (latestRow) {
        const latestStart = new Date(
          latestRow.effective_from as string,
        ).getTime();
        const latestUntil = latestRow.effective_until
          ? new Date(latestRow.effective_until as string).getTime()
          : null;
        const overlaps =
          latestUntil === null
            ? effectiveFrom.getTime() <= latestStart
            : effectiveFrom.getTime() < latestUntil;
        if (overlaps) {
          throw redemptionRateOverlapError({
            marketId,
            rateType: input.rateType,
            effectiveFrom: effectiveFrom.toISOString(),
            conflictingRateId: latestRow.id as string,
          });
        }
      }

      // 7/10. Append-only insert with the durable reason (migration 0031).
      const inserted = await tx.execute(
        sql`INSERT INTO redemption_rate_versions (
              market_id, rate_type, rate_value, effective_from, created_by, reason
            ) VALUES (
              ${marketId}, ${input.rateType}::redemption_rate_type,
              ${rateValue}, ${effectiveFrom}, ${actor.adminUserId}, ${reason}
            ) RETURNING id, market_id, rate_type, rate_value,
              effective_from, effective_until, created_by, created_at, reason`,
      );
      const version = inserted.rows[0];
      if (!version) {
        throw new RedemptionError(
          'REDEMPTION_RATE_CREATE_FAILED',
          'Failed to create rate version',
        );
      }

      // 11. Atomic immutable audit — same transaction as the insert.
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'redemption.rate_version.create',
        entity: { type: 'redemption_rate_version', id: version.id as string },
        marketId,
        after: this.sanitizeForAudit({
          rateValue: String(version.rate_value),
          rateType: String(version.rate_type),
          effectiveFrom: effectiveFrom.toISOString(),
          payloadHash,
        }),
        reason,
        result: 'SUCCESS',
        requestId: actor.requestId ?? idempotencyKey,
        ipAddress: actor.ipAddress,
        summary: `Administrator scheduled redemption rate ${String(version.rate_value)} ${String(version.rate_type)} for market ${marketId} effective ${effectiveFrom.toISOString()} (${localWallString(new Date(version.effective_from as string), market.timezone)} market-local).`,
      });

      const response: RedemptionRateVersionCreateResponse = {
        id: version.id as string,
        marketId,
        rateType: String(version.rate_type),
        rateValue: normalizeRateString(String(version.rate_value)),
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveFromLocal: localWallString(
          new Date(version.effective_from as string),
          market.timezone,
        ),
        timezone: market.timezone,
        reason: (version.reason as string | null) ?? null,
        createdBy: actor.adminUserId,
        createdAt: new Date(version.created_at as string).toISOString(),
      };

      // 9. Persist the original result for exact replay.
      await tx.execute(
        sql`UPDATE merchant_api_idempotency_keys
            SET response = ${JSON.stringify(response)}::jsonb,
                status_code = 201,
                updated_at = NOW()
            WHERE id = ${claimRow.id as string}`,
      );

      return response;
    });
  }

  /**
   * List rate versions for a market (admin read surface).
   *
   * D-053 §6/§9: cancelled future versions are flagged `CANCELLED` and the
   * response carries the per-market approved configuration
   * (`marketConfig.configured: false` for markets without an active rule —
   * no cross-market fallback). The `status` filter is honoured
   * (SCHEDULED / ACTIVE / EXPIRED / CANCELLED).
   */
  async listRateVersions(
    _actor: RedemptionAdminActor,
    marketId: string,
    filters: {
      page: number;
      pageSize: number;
      rateType?: string;
      status?: string;
    },
  ): Promise<{
    versions: RedemptionRateVersionListItem[];
    total: number;
    page: number;
    pageSize: number;
    marketConfig: RedemptionRateMarketConfig;
  }> {
    const db = this.database.db;
    const conditions: ReturnType<typeof sql>[] = [
      sql`v.market_id = ${marketId}`,
    ];

    if (filters.rateType) {
      conditions.push(
        sql`v.rate_type = ${filters.rateType}::redemption_rate_type`,
      );
    }
    const notCancelled = sql`NOT EXISTS (
      SELECT 1 FROM redemption_rate_cancellations c
      WHERE c.rate_version_id = v.id
    )`;
    switch (filters.status) {
      case 'CANCELLED':
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM redemption_rate_cancellations c
            WHERE c.rate_version_id = v.id
          )`,
        );
        break;
      case 'SCHEDULED':
        conditions.push(sql`${notCancelled} AND v.effective_from > NOW()`);
        break;
      case 'ACTIVE':
        conditions.push(
          sql`${notCancelled} AND v.effective_from <= NOW()
              AND (v.effective_until IS NULL OR v.effective_until > NOW())`,
        );
        break;
      case 'EXPIRED':
        conditions.push(
          sql`v.effective_until IS NOT NULL AND v.effective_until <= NOW()`,
        );
        break;
      default:
        break;
    }

    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;
    const offset = (filters.page - 1) * filters.pageSize;

    const countResult = await db.execute(
      sql`SELECT COUNT(*) as total FROM redemption_rate_versions v ${whereClause}`,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const result = await db.execute(
      sql`SELECT v.id, v.rate_type, v.rate_value, v.effective_from,
                 v.effective_until, v.created_by, v.created_at,
                 CASE WHEN c.id IS NULL THEN false ELSE true END AS cancelled
          FROM redemption_rate_versions v
          LEFT JOIN redemption_rate_cancellations c
            ON c.rate_version_id = v.id
          ${whereClause}
          ORDER BY v.effective_from DESC
          LIMIT ${filters.pageSize} OFFSET ${offset}`,
    );
    // Compute status from the effective range + cancellation record.
    const now = new Date();
    const versions = result.rows.map((row: Record<string, unknown>) => {
      const effectiveFrom = new Date(row.effective_from as string);
      const effectiveUntil = row.effective_until
        ? new Date(row.effective_until as string)
        : null;
      let status = 'SCHEDULED';
      if (row.cancelled) {
        status = 'CANCELLED';
      } else if (
        effectiveFrom <= now &&
        (!effectiveUntil || effectiveUntil > now)
      ) {
        status = 'ACTIVE';
      } else if (effectiveUntil && effectiveUntil <= now) {
        status = 'EXPIRED';
      }

      return {
        id: row.id as string,
        rateType: row.rate_type as string,
        rateValue: row.rate_value as string,
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveUntil: effectiveUntil ? effectiveUntil.toISOString() : null,
        status,
        createdAt: new Date(row.created_at as string).toISOString(),
      };
    });

    const rule = await this.marketRuleRow(marketId, 'POINTS_PER_CURRENCY');
    const marketConfig: RedemptionRateMarketConfig = rule
      ? {
          configured: true,
          initialRate: normalizeRateString(rule.initialRate),
          minimumRate: normalizeRateString(rule.minimumRate),
          maximumRate: normalizeRateString(rule.maximumRate),
          currency: rule.currency,
          displayUnit: rule.displayUnit,
        }
      : {
          configured: false,
          initialRate: null,
          minimumRate: null,
          maximumRate: null,
          currency: null,
          displayUnit: null,
        };

    return {
      versions,
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      marketConfig,
    };
  }

  /**
   * Secured Phase 6 redemption-rate owner cancel command (D-053 §9).
   *
   * A cancellation NEVER updates or deletes the immutable rate-version row
   * (append-only triggers + no UPDATE path). It records an append-only
   * immutable event in `redemption_rate_cancellations`; the resolver
   * ignores cancelled versions forever, so a cancelled scheduled version
   * can never become effective and no historical quote/order is touched.
   *
   * Only future-scheduled, not-yet-effective versions can be cancelled;
   * active, expired and historically used versions are rejected. Cancelling
   * requires the same identity/permission/selected-market/reason/
   * idempotency/audit guarantees as create.
   */
  async cancelRateVersion(
    actor: RedemptionAdminActor,
    rateId: string,
    input: CancelRateVersionCommand,
  ): Promise<RedemptionRateCancelResponse> {
    // ── Identity + permission (server-side, in-process-safe) ──────────
    if (!actor?.adminUserId) throw redemptionRatePermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'redemption.rate.manage',
    });
    if (!allowed) throw redemptionRatePermissionDeniedError();

    // ── Mandatory reason (blank/overlength rejected) ──────────────────
    const reason = input.reason?.trim() ?? '';
    if (!reason || reason.length > 500)
      throw redemptionRateReasonRequiredError();

    // ── Operation-scoped idempotency key (mandatory) ──────────────────
    const idempotencyKey = input.idempotencyKey?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw redemptionRateIdempotencyKeyRequiredError();
    }

    // ── Selected-market presence (before any business query) ─────────
    // §5/§9: an actor without a server Current Admin Market is rejected
    // BEFORE any resource/business query runs.
    if (!actor.currentMarketId)
      throw redemptionRateMarketSelectionRequiredError();

    // ── Load the immutable target version ─────────────────────────────
    const loaded = await this.database.db.execute(
      sql`SELECT id, market_id, rate_type, rate_value, effective_from,
                 effective_until
          FROM redemption_rate_versions
          WHERE id = ${rateId}
          LIMIT 1`,
    );
    const version = loaded.rows[0];
    if (!version) {
      throw new RedemptionError(
        'REDEMPTION_RATE_NOT_FOUND',
        'Rate version not found.',
        { rateId },
      );
    }
    const versionMarketId = version.market_id as string;
    const versionEffectiveFrom = new Date(version.effective_from as string);
    const versionEffectiveUntil = version.effective_until
      ? new Date(version.effective_until as string)
      : null;

    // ── Selected-market + resource-market consistency ────────────────
    if (actor.currentMarketId !== versionMarketId) {
      throw redemptionRateMarketContextMismatchError();
    }
    await this.assertMarketAccess(
      this.database.db,
      actor.adminUserId,
      versionMarketId,
    );
    const market = await this.marketRow(versionMarketId);
    if (!market) throw redemptionRateMarketNotFoundError();

    // ── Canonical payload hash (sorted keys + sha256) ─────────────────
    const payloadHash = canonicalPayloadHash({
      operation: 'cancel',
      marketId: versionMarketId,
      rateType: String(version.rate_type),
      rateValue: String(version.rate_value),
      localDate: localDateString(versionEffectiveFrom, market.timezone),
      effectiveFrom: versionEffectiveFrom.toISOString(),
      timezone: market.timezone,
      reason,
      targetVersionId: rateId,
      actorScope: `${REDEMPTION_RATE_OWNER_CANCEL_SCOPE}:${versionMarketId}:${actor.adminUserId}`,
    });

    const scope = `${REDEMPTION_RATE_OWNER_CANCEL_SCOPE}:${versionMarketId}:${actor.adminUserId}`;
    const lockKey = this.ownerLockKey(versionMarketId);

    // ── Idempotency replay/conflict BEFORE cancellability checks ─────
    // §10: a replayed key must return the original result (or a 409 on
    // payload mismatch) even though the version is now cancelled — the
    // cancellability pre-check below would otherwise reject the replay
    // as REDEMPTION_RATE_ALREADY_CANCELLED before the idempotency row is
    // ever consulted. Same-key/different-payload also surfaces as 409
    // IDEMPOTENCY_CONFLICT here (not ALREADY_CANCELLED).
    const prior = await this.database.db.execute(
      sql`SELECT id, response, request_hash
          FROM merchant_api_idempotency_keys
          WHERE scope = ${scope} AND key = ${idempotencyKey}
          LIMIT 1`,
    );
    const priorRow = prior.rows[0];
    if (priorRow) {
      if (priorRow.response === null || priorRow.request_hash !== payloadHash) {
        throw redemptionRateIdempotencyConflictError();
      }
      return priorRow.response as unknown as RedemptionRateCancelResponse;
    }

    // ── Cancellability pre-checks (re-checked inside the lock) ────────
    await this.assertCancellable(
      this.database.db,
      version,
      versionEffectiveFrom,
      versionEffectiveUntil,
    );

    // ── Atomic cancel: lock, idempotency, cancellability, audit ───────
    return this.database.runTransaction(async (tx) => {
      // Serialize with creates (and other cancels) on the same market.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      // Claim the operation key (replay/conflict semantics as for create).
      const claimed = await tx.execute(
        sql`INSERT INTO merchant_api_idempotency_keys (scope, key, request_hash)
            VALUES (${scope}, ${idempotencyKey}, ${payloadHash})
            ON CONFLICT (scope, key) DO NOTHING
            RETURNING id`,
      );
      const claimRow = claimed.rows[0];
      if (!claimRow) {
        const existing = await tx.execute(
          sql`SELECT id, response, status_code, request_hash
              FROM merchant_api_idempotency_keys
              WHERE scope = ${scope} AND key = ${idempotencyKey}
              LIMIT 1`,
        );
        const row = existing.rows[0];
        if (!row || row.response === null || row.request_hash !== payloadHash) {
          throw redemptionRateIdempotencyConflictError();
        }
        return row.response as unknown as RedemptionRateCancelResponse;
      }

      // Re-check cancellability inside the lock (race-safe).
      await this.assertCancellable(
        tx,
        version,
        versionEffectiveFrom,
        versionEffectiveUntil,
      );

      // Append-only immutable cancellation event (migration 0031).
      const cancelled = await tx.execute(
        sql`INSERT INTO redemption_rate_cancellations (
              rate_version_id, market_id, cancelled_by, reason, request_id
            ) VALUES (
              ${rateId}, ${versionMarketId}, ${actor.adminUserId},
              ${reason}, ${actor.requestId ?? null}
            ) RETURNING id, rate_version_id, market_id, cancelled_by,
              reason, request_id, created_at`,
      );
      const cancellation = cancelled.rows[0];
      if (!cancellation) {
        throw new RedemptionError(
          'REDEMPTION_RATE_CANCELLATION_FAILED',
          'Failed to cancel rate version',
        );
      }

      // Atomic immutable audit — same transaction as the cancellation.
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'redemption.rate_version.cancel',
        entity: {
          type: 'redemption_rate_cancellation',
          id: cancellation.id as string,
        },
        marketId: versionMarketId,
        after: this.sanitizeForAudit({
          rateVersionId: rateId,
          rateValue: String(version.rate_value),
          rateType: String(version.rate_type),
          effectiveFrom: versionEffectiveFrom.toISOString(),
          payloadHash,
        }),
        reason,
        result: 'SUCCESS',
        requestId: actor.requestId ?? idempotencyKey,
        ipAddress: actor.ipAddress,
        summary: `Administrator cancelled scheduled redemption rate version ${rateId} (${String(version.rate_value)} ${String(version.rate_type)}) for market ${versionMarketId}.`,
      });

      const response: RedemptionRateCancelResponse = {
        id: cancellation.id as string,
        rateVersionId: rateId,
        marketId: versionMarketId,
        rateType: String(version.rate_type),
        rateValue: normalizeRateString(String(version.rate_value)),
        effectiveFrom: versionEffectiveFrom.toISOString(),
        reason,
        cancelledBy: actor.adminUserId,
        cancelledAt: new Date(cancellation.created_at as string).toISOString(),
      };

      // Persist the original result for exact replay.
      await tx.execute(
        sql`UPDATE merchant_api_idempotency_keys
            SET response = ${JSON.stringify(response)}::jsonb,
                status_code = 200,
                updated_at = NOW()
            WHERE id = ${claimRow.id as string}`,
      );

      return response;
    });
  }

  /**
   * Get the effective rate for a market at the current time.
   * Returns the most recent rate version whose effective range covers NOW().
   * Canonical: uses rate_type = 'POINTS_PER_CURRENCY' (default conversion type).
   *
   * D-053 §7/§9: the resolver excludes cancelled versions (a cancelled
   * scheduled version can never become effective) and respects legacy
   * stored window ends. Frozen quote/order snapshots are never repriced.
   */
  async getEffectiveRate(marketId: string): Promise<RedemptionRateVersion> {
    const db = this.database.db;
    const result = await db.execute(
      sql`SELECT * FROM redemption_rate_versions
          WHERE market_id = ${marketId}
            AND rate_type = 'POINTS_PER_CURRENCY'::redemption_rate_type
            AND effective_from <= NOW()
            AND (effective_until IS NULL OR effective_until > NOW())
            AND NOT EXISTS (
              SELECT 1 FROM redemption_rate_cancellations c
              WHERE c.rate_version_id = redemption_rate_versions.id
            )
          ORDER BY effective_from DESC
          LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) {
      throw new RedemptionError(
        'REDEMPTION_RATE_NOT_FOUND',
        'No effective rate version found for this market.',
        { marketId },
      );
    }
    return this.toRateVersion(row);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // D-053 OWNER HELPERS — identity, market, config, cancellation
  // ═════════════════════════════════════════════════════════════════════════

  private async marketRow(
    marketId: string,
  ): Promise<{ id: string; code: string; timezone: string } | undefined> {
    const rows = await this.database.db
      .select({
        id: markets.id,
        code: markets.code,
        timezone: markets.timezone,
      })
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.status, 'ACTIVE')))
      .limit(1);
    return rows[0];
  }

  private async assertMarketAccess(
    db: DbExecutor,
    adminUserId: string,
    marketId: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: adminUsers.id })
      .from(marketAccess)
      .innerJoin(adminUsers, eq(adminUsers.id, marketAccess.adminUserId))
      .innerJoin(markets, eq(markets.id, marketAccess.marketId))
      .where(
        and(
          eq(marketAccess.adminUserId, adminUserId),
          eq(marketAccess.marketId, marketId),
          isNull(marketAccess.revokedAt),
          eq(adminUsers.status, 'ACTIVE'),
          eq(markets.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!rows[0]) throw redemptionRateMarketAccessDeniedError();
  }

  /**
   * Active approved rate rule for the market (D-053 §6). Keyed by the
   * canonical market code — NO cross-market fallback: a market without an
   * explicit active rule resolves to `undefined` and the owner blocks it.
   */
  private async marketRuleRow(
    marketId: string,
    rateType: string,
    db: DbExecutor = this.database.db,
  ): Promise<
    | {
        initialRate: string;
        minimumRate: string;
        maximumRate: string;
        currency: string;
        displayUnit: string;
      }
    | undefined
  > {
    const rows = await db
      .select({
        initialRate: redemptionRateMarketRules.initialRate,
        minimumRate: redemptionRateMarketRules.minimumRate,
        maximumRate: redemptionRateMarketRules.maximumRate,
        currency: redemptionRateMarketRules.currency,
        displayUnit: redemptionRateMarketRules.displayUnit,
      })
      .from(redemptionRateMarketRules)
      .innerJoin(
        markets,
        eq(markets.code, redemptionRateMarketRules.marketCode),
      )
      .where(
        and(
          eq(markets.id, marketId),
          eq(
            redemptionRateMarketRules.rateType,
            rateType as RedemptionRateTypeValue,
          ),
          eq(redemptionRateMarketRules.isActive, true),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * D-053 §9 cancellability: only future-scheduled, not-yet-effective,
   * never-used versions can be cancelled. Active/expired/historically used
   * versions are rejected. Runs outside the lock for a clean early error
   * and again INSIDE the lock for race safety.
   */
  private async assertCancellable(
    db: DbExecutor,
    version: Record<string, unknown>,
    effectiveFrom: Date,
    effectiveUntil: Date | null,
  ): Promise<void> {
    const alreadyCancelled = await db.execute(
      sql`SELECT 1 FROM redemption_rate_cancellations
          WHERE rate_version_id = ${version.id}
          LIMIT 1`,
    );
    if (alreadyCancelled.rows[0]) throw redemptionRateAlreadyCancelledError();

    if (effectiveFrom.getTime() <= Date.now()) {
      throw redemptionRateCannotCancelEffectiveError({
        rateVersionId: version.id,
        effectiveFrom: effectiveFrom.toISOString(),
      });
    }
    if (effectiveUntil && effectiveUntil.getTime() <= Date.now()) {
      throw redemptionRateCannotCancelEffectiveError({
        rateVersionId: version.id,
        reason: 'expired',
      });
    }
    const used = await db.execute(
      sql`SELECT 1 FROM (
            SELECT 1 FROM redemption_quotes
            WHERE rate_version_id = ${version.id}
            UNION ALL
            SELECT 1 FROM redemption_orders
            WHERE rate_version_id = ${version.id}
          ) t
          LIMIT 1`,
    );
    if (used.rows[0]) {
      throw redemptionRateCannotCancelEffectiveError({
        rateVersionId: version.id,
        reason: 'historically-used',
      });
    }
  }

  /**
   * Market-scoped owner advisory-lock key shared by create and cancel so
   * every owner mutation of a market's rate schedule serializes together.
   */
  private ownerLockKey(marketId: string): bigint {
    return this.hashKeyToBigInt(`d053:redemption-rate-owner:${marketId}`);
  }

  private sanitizeForAudit(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PICKUP LOCATION CRUD (P6-S2) — Canonical Schema
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Create a pickup location (admin only).
   * Canonical columns: market_id, name, address (jsonb), contact_name,
   *   contact_phone, operating_hours (jsonb), is_active, created_by.
   * No flat address fields, no sort_order.
   */
  async createPickupLocation(
    actor: RedemptionAdminActor,
    input: {
      marketId: string;
      name: string;
      address: Record<string, unknown>;
      contactName?: string;
      contactPhone?: string;
      operatingHours?: Record<string, unknown>;
      isActive?: boolean;
      idempotencyKey: string;
    },
  ): Promise<RedemptionPickupLocation> {
    const db = this.database.db;

    const result = await db.execute(
      sql`INSERT INTO redemption_pickup_locations (
          market_id, name, address, contact_name, contact_phone,
          operating_hours, is_active, created_by
        ) VALUES (
          ${input.marketId}, ${input.name}, ${JSON.stringify(input.address)},
          ${input.contactName ?? null}, ${input.contactPhone ?? null},
          ${JSON.stringify(input.operatingHours ?? {})},
          ${input.isActive ?? true}, ${actor.adminUserId}
        ) RETURNING *`,
    );
    const locRow = result.rows[0];
    if (!locRow)
      throw new RedemptionError(
        'REDEMPTION_PICKUP_CREATE_FAILED',
        'Failed to create pickup location',
      );
    return this.toPickupLocation(locRow);
  }

  /**
   * Update a pickup location (admin only).
   * Canonical: no archived_at, address is always jsonb.
   */
  async updatePickupLocation(
    actor: RedemptionAdminActor,
    locationId: string,
    input: Record<string, unknown>,
  ): Promise<RedemptionPickupLocation> {
    const db = this.database.db;

    const existing = await db.execute(
      sql`SELECT id FROM redemption_pickup_locations
          WHERE id = ${locationId}`,
    );
    if (!existing.rows[0]) {
      throw new RedemptionError(
        'REDEMPTION_PICKUP_LOCATION_NOT_FOUND',
        'Pickup location not found.',
        { locationId },
      );
    }

    // Build field map with canonical column names
    const fieldMap: Record<string, unknown> = {};
    if (input.name !== undefined) fieldMap['name'] = input.name;
    if (input.contactName !== undefined)
      fieldMap['contact_name'] = input.contactName;
    if (input.contactPhone !== undefined)
      fieldMap['contact_phone'] = input.contactPhone;
    if (input.operatingHours !== undefined) {
      fieldMap['operating_hours'] = input.operatingHours;
    }
    if (input.isActive !== undefined) fieldMap['is_active'] = input.isActive;
    if (input.address !== undefined) {
      fieldMap['address'] = input.address;
    }

    if (Object.keys(fieldMap).length === 0) {
      throw new RedemptionError(
        'REDEMPTION_PICKUP_LOCATION_NOT_FOUND',
        'No fields to update.',
        { locationId },
      );
    }

    let updateSql = sql`UPDATE redemption_pickup_locations SET `;
    const entries = Object.entries(fieldMap);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const [col, val] = entry;
      if (i > 0) updateSql = sql`${updateSql}, `;
      // Serialize jsonb values
      const dbVal =
        col === 'address' || col === 'operating_hours'
          ? JSON.stringify(val)
          : val;
      updateSql = sql`${updateSql} ${sql.identifier(col)} = ${dbVal}`;
    }

    updateSql = sql`${updateSql}, updated_at = NOW()
      WHERE id = ${locationId} RETURNING *`;
    const result = await db.execute(updateSql);
    const updatedLocRow = result.rows[0];
    if (!updatedLocRow)
      throw new RedemptionError(
        'REDEMPTION_PICKUP_NOT_FOUND',
        'Pickup location not found',
      );
    return this.toPickupLocation(updatedLocRow);
  }

  /**
   * List pickup locations for a market.
   * Canonical: no archived_at filter.
   */
  async listPickupLocations(
    _actor: RedemptionAdminActor,
    marketId: string,
    filters: {
      page: number;
      pageSize: number;
      isActive?: boolean;
    },
  ): Promise<{
    locations: RedemptionPickupLocationListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const db = this.database.db;
    const conditions: ReturnType<typeof sql>[] = [sql`market_id = ${marketId}`];

    if (filters.isActive !== undefined) {
      conditions.push(sql`is_active = ${filters.isActive}`);
    }

    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;
    const offset = (filters.page - 1) * filters.pageSize;

    const countResult = await db.execute(
      sql`SELECT COUNT(*) as total FROM redemption_pickup_locations ${whereClause}`,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const listResult = await db.execute(
      sql`SELECT id, name, address, is_active
          FROM redemption_pickup_locations ${whereClause}
          ORDER BY name ASC
          LIMIT ${filters.pageSize} OFFSET ${offset}`,
    );
    return {
      locations: listResult.rows.map((row: Record<string, unknown>) => {
        const addr = row.address as Record<string, unknown> | null;
        return {
          id: row.id as string,
          name: row.name as string,
          address: addr ?? {},
          isActive: row.is_active as boolean,
        };
      }),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  /**
   * Get pickup location detail.
   */
  async getPickupLocation(
    _actor: RedemptionAdminActor,
    locationId: string,
  ): Promise<RedemptionPickupLocation> {
    const db = this.database.db;
    const result = await db.execute(
      sql`SELECT * FROM redemption_pickup_locations
          WHERE id = ${locationId}`,
    );
    const row = result.rows[0];
    if (!row) {
      throw new RedemptionError(
        'REDEMPTION_PICKUP_LOCATION_NOT_FOUND',
        'Pickup location not found.',
        { locationId },
      );
    }
    return this.toPickupLocation(row);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // QUOTE GENERATION (P6-S3) — Canonical Schema
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Generate a quote for a catalog item.
   *
   * Rate Conversion Pricing (OD-21):
   *   required_iPoint = fiat_reference_value / redemption_rate
   *
   * Rate Locked at Quote Time (OD-22):
   *   Rate version captured at generation time.
   *   Client must NOT submit price/rate.
   *
   * Canonical redemption_quotes columns:
   *   member_id, market_id, catalog_item_id, status, rate_version_id,
   *   rate_snapshot (jsonb), unrounded_point_cost, posted_point_cost,
   *   payload_hash, expires_at, consumed_at, idempotency_key, created_at
   */
  async generateQuote(
    memberId: string,
    memberMarketId: string,
    itemId: string,
    quantity: number,
  ): Promise<RedemptionQuote> {
    const db = this.database.db;

    // Load item (must be active in the member's market)
    const itemResult = await db.execute(
      sql`SELECT * FROM redemption_catalog_items
          WHERE id = ${itemId}
            AND market_id = ${memberMarketId}
            AND status = 'ACTIVE'::redemption_catalog_status
            AND effective_from <= NOW()
            AND (effective_until IS NULL OR effective_until > NOW())`,
    );
    const item = itemResult.rows[0];
    if (!item) {
      throw new RedemptionError(
        'REDEMPTION_CATALOG_ITEM_NOT_FOUND',
        'Item not found or not available.',
        { itemId },
      );
    }

    // Load effective rate for the market (OD-22: rate locked at quote time)
    // Canonical: use POINTS_PER_CURRENCY rate type.
    // D-053 §7/§9: the resolver excludes cancelled versions so a cancelled
    // scheduled version can never lock into a new quote; existing frozen
    // quote/order snapshots are never repriced.
    const rateResult = await db.execute(
      sql`SELECT * FROM redemption_rate_versions
          WHERE market_id = ${memberMarketId}
            AND rate_type = 'POINTS_PER_CURRENCY'::redemption_rate_type
            AND effective_from <= NOW()
            AND (effective_until IS NULL OR effective_until > NOW())
            AND NOT EXISTS (
              SELECT 1 FROM redemption_rate_cancellations c
              WHERE c.rate_version_id = redemption_rate_versions.id
            )
          ORDER BY effective_from DESC
          LIMIT 1`,
    );
    const rateVersion = rateResult.rows[0];
    if (!rateVersion) {
      throw new RedemptionError(
        'REDEMPTION_RATE_NOT_FOUND',
        'No effective rate version for this market.',
        { marketId: memberMarketId },
      );
    }

    // Rate Conversion Pricing (OD-21): required_iPoint = fiat_reference_value / rate
    const fiatValue = item.fiat_reference_value as string;
    const rateValue = rateVersion.rate_value as string;
    // Compute per-unit and total using NUMERIC arithmetic
    const unroundedPerUnit = this.computePointCost(fiatValue, rateValue);
    const unroundedTotal = this.multiplyDecimal(
      unroundedPerUnit,
      String(quantity),
    );

    // Posted point cost: apply HALF_UP rounding to calculation_scale (10)
    const postedPerUnit = this.roundHalfUp(unroundedPerUnit, 10);
    const postedTotal = this.multiplyDecimal(postedPerUnit, String(quantity));

    // Build rate snapshot for immutable record
    const rateSnapshot = {
      rateVersionId: rateVersion.id,
      rateType: rateVersion.rate_type,
      rateValue: rateValue,
    };

    // Build immutable payload hash for tamper prevention
    const payloadData = {
      catalogItemId: itemId,
      itemVersion: Number(item.version),
      quantity,
      rateVersionId: rateVersion.id,
      rateValue,
      fiatReferenceValue: fiatValue,
      fiatCurrency: item.fiat_currency,
    };
    const payloadHash = this.hashPayload(payloadData);

    // Quote expiry: 15 minutes from now
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Idempotency key derived from member + item + quantity
    // Includes a millisecond timestamp suffix to ensure freshness
    const idempotencyBase = `quote:${memberId}:${itemId}:${quantity}`;
    const idempotencyKey = `${idempotencyBase}:${Date.now()}`;

    // Insert quote — canonical columns only
    const quoteResult = await db.execute(
      sql`INSERT INTO redemption_quotes (
          member_id, market_id, catalog_item_id, status,
          rate_version_id, rate_snapshot,
          unrounded_point_cost, posted_point_cost,
          payload_hash, expires_at, idempotency_key
        ) VALUES (
          ${memberId}, ${memberMarketId}, ${itemId}, 'VALID'::redemption_quote_status,
          ${rateVersion.id}, ${JSON.stringify(rateSnapshot)},
          ${unroundedTotal}, ${postedTotal},
          ${payloadHash}, ${expiresAt}, ${idempotencyKey}
        )
        ON CONFLICT (idempotency_key)
        DO NOTHING
        RETURNING *`,
    );
    let quote = quoteResult.rows[0];
    if (!quote) {
      // Idempotency key already exists — return the existing quote
      const existing = await db.execute(
        sql`SELECT * FROM redemption_quotes WHERE idempotency_key = ${idempotencyKey}`,
      );
      quote = existing.rows[0];
    }
    if (!quote)
      throw new RedemptionError(
        'REDEMPTION_QUOTE_FAILED',
        'Failed to generate quote',
      );

    return {
      quoteId: quote.id as string,
      catalogItemId: quote.catalog_item_id as string,
      marketId: quote.market_id as string,
      rateVersionId: quote.rate_version_id as string,
      rateSnapshot: quote.rate_snapshot as Record<string, unknown>,
      unroundedPointCost: quote.unrounded_point_cost as string,
      postedPointCost: quote.posted_point_cost as string,
      quantity: Number(quantity),
      payloadHash: quote.payload_hash as string,
      expiresAt: new Date(quote.expires_at as string).toISOString(),
      createdAt: new Date(quote.created_at as string).toISOString(),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ORDER CONFIRMATION (P6-S4) — Canonical Atomic Confirm Sequence
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Atomically confirm a redemption order with Direct Atomic Debit.
   *
   * Canonical Atomic Confirm Sequence:
   *   BEGIN TRANSACTION
   *     1. Acquire idempotency guard (advisory lock + check)
   *     2. Load quote with JOIN to catalog item
   *     3. Validate quote (not consumed, not expired)
   *     4. Validate item version matches
   *     5. Validate payload hash
   *     6. Validate expected total points
   *     7. Acquire wallet advisory lock
   *     8. Load wallet account and check balance
   *     9. Check member eligibility (status, KYC)
   *    10. Check item still active
   *    11. Check rate version still valid
   *    12. Acquire inventory lock and check sufficiency
   *    13. Validate shipping payment (if delivery)
   *    14. INSERT wallet entry (REDEMPTION_DEBIT)
   *    15. UPDATE wallet projection
   *    16. UPDATE inventory (decrement)
   *    17. INSERT redemption_order
   *    18. INSERT fulfilment record
   *    19. Mark quote consumed
   *    20. Mark shipping payment consumed
   *    21. INSERT audit log
   *    22. Record terms acceptance
   *   COMMIT (rollback on any failure)
   */
  async confirmOrder(
    memberId: string,
    marketId: string,
    input: ConfirmOrderInput,
    meta: { ipAddress?: string; requestId?: string; userAgent?: string | null },
  ): Promise<RedemptionOrderResponse> {
    const db = this.database.db;
    let recoveryPayment: Record<string, unknown> | null = null;
    let recoveryOrderId: string | null = null;
    let shippingPaymentConsumed = false;

    // ── Step 0: Short-circuit terms not accepted ────────────────────────
    if (!input.termsAcceptance.accepted) {
      throw new RedemptionError(
        'REDEMPTION_TERMS_NOT_ACCEPTED',
        'You must accept the redemption terms to proceed.',
      );
    }

    // Begin atomic confirm transaction
    const confirmation = db.transaction(async (tx) => {
      // ═══════════════════════════════════════════════════════════════════
      // VALIDATION PHASE
      // ═══════════════════════════════════════════════════════════════════

      // ── Step 1: Idempotency guard ─────────────────────────────────────
      const idempotencyKey = input.idempotencyKey;
      const idemLockKey = this.hashKeyToBigInt(`idem:${idempotencyKey}`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${idemLockKey})`);

      // Check if order already exists for this idempotency key
      const existingOrder = await tx.execute(
        sql`SELECT * FROM redemption_orders
            WHERE idempotency_key = ${idempotencyKey}`,
      );
      const existingRow = existingOrder.rows[0];
      if (existingRow) {
        const samePayload =
          existingRow.member_id === memberId &&
          existingRow.market_id === marketId &&
          existingRow.quote_id === input.quoteId &&
          this.equalDecimal(
            existingRow.total_points as string,
            input.expectedTotalPoints,
          ) &&
          this.equalDecimal(
            existingRow.quantity as string,
            input.expectedQuantity,
          );
        if (!samePayload) {
          throw new RedemptionError(
            'REDEMPTION_IDEMPOTENCY_MISMATCH',
            'This idempotency key was already used for a different redemption confirmation.',
            { idempotencyKey },
          );
        }
        return this.mapOrderToResponse(existingRow);
      }

      // ── Step 2: Load quote with catalog item JOIN ────────────────────
      const quoteResult = await tx.execute(
        sql`SELECT q.*, ci.name as item_name, ci.fulfilment_mode,
                    ci.inventory_mode, ci.sku as item_sku,
                    ci.item_type, ci.version as catalog_version,
                    ci.status as item_status,
                    ci.fiat_reference_value, ci.fiat_currency
            FROM redemption_quotes q
            JOIN redemption_catalog_items ci ON ci.id = q.catalog_item_id
            WHERE q.id = ${input.quoteId}
              AND q.member_id = ${memberId}`,
      );
      const quote = quoteResult.rows[0];
      if (!quote) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_NOT_FOUND',
          'Quote not found for this member.',
          { quoteId: input.quoteId },
        );
      }
      if (quote.market_id !== marketId) {
        throw new RedemptionError(
          'REDEMPTION_MARKET_MISMATCH',
          'Quote does not belong to the current market.',
          { quoteId: input.quoteId, marketId },
        );
      }
      if (quote.consumed_at !== null) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_EXPIRED',
          'This quote has already been consumed.',
          { quoteId: input.quoteId },
        );
      }

      // ── Step 3: Validate quote not consumed (check existing orders)
      const orderForQuote = await tx.execute(
        sql`SELECT id FROM redemption_orders WHERE quote_id = ${quote.id} LIMIT 1`,
      );
      if (orderForQuote.rows[0]) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_EXPIRED',
          'This quote has already been consumed.',
          { quoteId: input.quoteId },
        );
      }

      // ── Step 4: Validate quote not expired ───────────────────────────
      if (new Date(quote.expires_at as string) < new Date()) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_EXPIRED',
          'Quote has expired. Please generate a new quote.',
          { quoteId: input.quoteId },
        );
      }

      // ── Step 5: Validate expected item version ──────────────────────
      if (Number(quote.catalog_version) !== input.expectedItemVersion) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_STALE',
          'The catalog item has been updated since the quote was generated. Please generate a new quote.',
          {
            quoteId: input.quoteId,
            expectedVersion: input.expectedItemVersion,
            actualVersion: Number(quote.catalog_version),
          },
        );
      }

      // ── Step 6: Validate payload hash (tamper detection) ──────────────
      const payloadData: Record<string, unknown> = {
        catalogItemId: quote.catalog_item_id as string,
        itemVersion: input.expectedItemVersion,
        quantity: Number(input.expectedQuantity),
        rateVersionId: quote.rate_version_id as string,
        rateValue:
          ((quote.rate_snapshot as Record<string, unknown>)
            ?.rateValue as string) ?? '',
        fiatReferenceValue: quote.fiat_reference_value as string,
        fiatCurrency: quote.fiat_currency as string,
      };
      const expectedHash = this.hashPayload(payloadData);
      if (quote.payload_hash !== expectedHash) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_TAMPERED',
          'Quote payload hash mismatch. Possible data tampering detected.',
          { quoteId: input.quoteId },
        );
      }

      // ── Step 7: Validate expected total points ───────────────────────
      const quoteTotalPoints = quote.posted_point_cost as string;
      if (quoteTotalPoints !== input.expectedTotalPoints) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_POINT_MISMATCH',
          'Total points mismatch. The server-calculated total differs from client expectation.',
          {
            quoteId: input.quoteId,
            serverTotalPoints: quoteTotalPoints,
            clientTotalPoints: input.expectedTotalPoints,
          },
        );
      }

      // ── Step 8: Acquire wallet advisory lock ─────────────────────────
      const walletLockKey = this.hashKeyToBigInt(
        `wallet:${memberId}:${marketId}`,
      );
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${walletLockKey})`);

      // ── Step 9: Load wallet account ──────────────────────────────────
      const walletResult = await tx.execute(
        sql`SELECT * FROM member_wallet_accounts
            WHERE member_id = ${memberId}
              AND market_id = ${marketId}`,
      );
      const wallet = walletResult.rows[0];
      if (!wallet) {
        throw new RedemptionError(
          'REDEMPTION_WALLET_NOT_FOUND',
          'Wallet account not found for this member and market.',
          { memberId, marketId },
        );
      }

      // ── Step 10: Check member eligibility ───────────────────────────
      const memberResult = await tx.execute(
        sql`SELECT status, kyc_level FROM members WHERE id = ${memberId}`,
      );
      const memberRow = memberResult.rows[0];
      if (!memberRow) {
        throw new RedemptionError(
          'REDEMPTION_MEMBER_NOT_FOUND',
          'Member not found.',
          { memberId },
        );
      }
      if ((memberRow.status as string) === 'SUSPENDED') {
        throw new RedemptionError(
          'REDEMPTION_MEMBER_SUSPENDED',
          'Your account is suspended and cannot redeem items.',
          { memberId },
        );
      }
      const kycLevel = memberRow.kyc_level as string;
      if (kycLevel !== 'LEVEL_2') {
        throw new RedemptionError(
          'REDEMPTION_KYC_REQUIRED',
          'KYC Level 2 is required before redeeming items.',
          { memberId, kycLevel },
        );
      }

      // ── Step 11: Check item is still active ─────────────────────────
      if ((quote.item_status as string) !== 'ACTIVE') {
        throw new RedemptionError(
          'REDEMPTION_CATALOG_ITEM_NOT_FOUND',
          'Item is no longer available for redemption.',
          { itemId: quote.catalog_item_id },
        );
      }

      // ── Step 12: Load rate version for order record (no expiry rejection)
      // A quote locks the rate at generation time; the snapshot is the binding record.
      // We do NOT reject a valid quote just because its original rate version later expired.
      const lockedRateSnapshot =
        typeof quote.rate_snapshot === 'object' &&
        quote.rate_snapshot !== null &&
        !Array.isArray(quote.rate_snapshot)
          ? (quote.rate_snapshot as Record<string, unknown>)
          : {};
      const rateValue = lockedRateSnapshot['rateValue'] ?? '0';
      const rateVersion = {
        rate_value: rateValue,
        rate_version_id: quote.rate_version_id,
      };

      // ── Step 13: Enforce wallet balance ────────────────────────────
      const availableBalance = wallet.available_balance as string;
      if (!this.gteDecimal(availableBalance, quoteTotalPoints)) {
        throw new RedemptionError(
          'REDEMPTION_BALANCE_INSUFFICIENT',
          'Insufficient wallet balance to complete this redemption.',
          {
            availableBalance,
            requiredPoints: quoteTotalPoints,
          },
        );
      }

      // ── Step 14: Check inventory ─────────────────────────────────────
      const requestedQty = input.expectedQuantity;
      let isBackordered = false;
      let backorderQuantity = '0';
      let inventoryRow: Record<string, unknown> | null = null;
      let inventoryVersion = 0;
      let shippingPayment: Record<string, unknown> | null = null;
      let shippingFee = '0.00';

      const invResult = await tx.execute(
        sql`SELECT * FROM redemption_inventory
            WHERE item_id = ${quote.catalog_item_id}
            FOR NO KEY UPDATE`,
      );
      inventoryRow = invResult.rows[0] ?? null;

      if (inventoryRow && (quote.inventory_mode as string) !== 'UNLIMITED') {
        inventoryVersion = Number(inventoryRow.version);
        const totalQuantity = inventoryRow.total_quantity as string | null;
        const reserved = inventoryRow.committed_quantity as string;
        const fulfilled = inventoryRow.fulfilled_quantity as string;
        const backorderQ = inventoryRow.backorder_quantity as string;

        const usedTotal = this.addDecimal(
          reserved,
          this.addDecimal(fulfilled, backorderQ),
        );

        if (totalQuantity !== null) {
          const available = this.subtractDecimal(totalQuantity, usedTotal);

          if (this.ltDecimal(available, requestedQty)) {
            // Check if backorder is allowed (only for DELIVERY)
            if ((quote.fulfilment_mode as string) !== 'DELIVERY') {
              throw new RedemptionError(
                'REDEMPTION_INVENTORY_INSUFFICIENT',
                'Insufficient inventory for this item.',
                {
                  itemId: quote.catalog_item_id,
                  available,
                  requested: requestedQty,
                },
              );
            }
            isBackordered = true;
            backorderQuantity = this.subtractDecimal(requestedQty, available);
          }
        }
      }

      // ── Step 15: Validate shipping payment (if delivery) ────────────
      if (input.fulfilment.type === 'DELIVERY') {
        if (!input.shippingPaymentIntentReference) {
          throw new RedemptionError(
            'REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND',
            'A paid shipping payment is required for delivery.',
            { quoteId: quote.id },
          );
        }

        const marketCurrencyResult = await tx.execute(
          sql`SELECT currency_code FROM markets WHERE id = ${marketId}`,
        );
        const marketCurrency = marketCurrencyResult.rows[0]?.currency_code;
        if (!marketCurrency) {
          throw new RedemptionError(
            'REDEMPTION_MARKET_NOT_FOUND',
            'Order market currency could not be resolved.',
            { marketId },
          );
        }
        shippingFee = this.getShippingFee(marketId);
        const requestHash = this.shippingPaymentRequestHash(
          memberId,
          marketId,
          quote.id as string,
          shippingFee,
          marketCurrency as string,
        );
        const shipPayResult = await tx.execute(
          sql`SELECT * FROM redemption_shipping_payments
              WHERE id = ${input.shippingPaymentIntentReference}
              FOR UPDATE`,
        );
        shippingPayment = shipPayResult.rows[0] ?? null;
        if (!shippingPayment) {
          throw new RedemptionError(
            'REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND',
            'Shipping payment not found.',
            { paymentId: input.shippingPaymentIntentReference },
          );
        }
        const validPayment =
          shippingPayment.status === 'PAID' &&
          shippingPayment.paid_at !== null &&
          shippingPayment.consumed_at === null &&
          shippingPayment.member_id === memberId &&
          shippingPayment.quote_id === quote.id &&
          shippingPayment.market_id === marketId &&
          this.equalDecimal(shippingPayment.amount as string, shippingFee) &&
          shippingPayment.currency === marketCurrency &&
          shippingPayment.request_hash === requestHash &&
          shippingPayment.order_id === null;
        if (!validPayment) {
          throw new RedemptionError(
            'REDEMPTION_SHIPPING_PAYMENT_MISMATCH',
            'Shipping payment is not paid, is already consumed, or does not match this order.',
            { paymentId: input.shippingPaymentIntentReference },
          );
        }
        recoveryPayment = shippingPayment;
      }

      // ═══════════════════════════════════════════════════════════════════
      // EXECUTION PHASE
      // ═══════════════════════════════════════════════════════════════════

      // ── Step 16: Compute new wallet balance ─────────────────────────
      const walletVersion = Number(wallet.version);
      const balanceBefore = wallet.available_balance as string;
      const balanceAfter = this.subtractDecimal(
        balanceBefore,
        quoteTotalPoints,
      );

      // ── Step 17: Get entry sequence number ────────────────────────────
      const maxSeqResult = await tx.execute(
        sql`SELECT COALESCE(MAX(entry_sequence), 0) + 1 AS next_seq
            FROM member_wallet_entries
            WHERE wallet_account_id = ${wallet.id}`,
      );
      const entrySequence =
        maxSeqResult.rows[0]?.next_seq != null
          ? String(maxSeqResult.rows[0].next_seq as number)
          : '1';

      // ── Step 18: INSERT wallet entry ────────────────────────────────
      const walletEntryResult = await tx.execute(
        sql`INSERT INTO member_wallet_entries (
            wallet_account_id, member_id, market_id, entry_sequence,
            entry_type, amount, balance_before, balance_after,
            idempotency_key, reference_type, reference_id,
            description, actor_id
          ) VALUES (
            ${wallet.id}, ${memberId}, ${marketId}, ${entrySequence},
            'REDEMPTION_DEBIT'::member_wallet_entry_type,
            ${quoteTotalPoints},
            ${balanceBefore}, ${balanceAfter},
            ${idempotencyKey},
            'REDEMPTION_ORDER', NULL,
            ${`Redemption: ${(quote.item_name as string) ?? 'item'}`},
            ${memberId}
          ) RETURNING id`,
      );
      const walletEntryRow = walletEntryResult.rows[0];
      if (!walletEntryRow)
        throw new RedemptionError(
          'REDEMPTION_WALLET_DEBIT_FAILED',
          'Wallet entry creation failed',
        );
      const walletEntryId = walletEntryRow.id as string;

      // ── Step 19: UPDATE wallet account balance (version check) ──────
      const updateWalletResult = await tx.execute(
        sql`UPDATE member_wallet_accounts
            SET available_balance = ${balanceAfter},
                version = version + 1
            WHERE id = ${wallet.id}
              AND version = ${walletVersion}
            RETURNING id`,
      );
      if (!updateWalletResult.rows[0]) {
        throw new RedemptionError(
          'REDEMPTION_WALLET_VERSION_CONFLICT',
          'Wallet balance was concurrently modified. Please retry.',
        );
      }

      // ── Step 20: Update inventory (version check) ───────────────────
      if (inventoryRow && (quote.inventory_mode as string) !== 'UNLIMITED') {
        if (!isBackordered) {
          await tx.execute(
            sql`UPDATE redemption_inventory
                SET committed_quantity = committed_quantity + ${requestedQty}::numeric,
                    version = version + 1
                WHERE id = ${inventoryRow.id}
                  AND version = ${inventoryVersion}`,
          );
        } else {
          const totalQt = (inventoryRow.total_quantity as string) ?? '0';
          const usedTotal = this.addDecimal(
            inventoryRow.committed_quantity as string,
            this.addDecimal(
              inventoryRow.fulfilled_quantity as string,
              inventoryRow.backorder_quantity as string,
            ),
          );
          const availStock = this.subtractDecimal(totalQt, usedTotal);
          const reserveQty = this.maxDecimal('0', availStock);
          const backorderQty = this.subtractDecimal(requestedQty, reserveQty);

          await tx.execute(
            sql`UPDATE redemption_inventory
                SET committed_quantity = committed_quantity + ${reserveQty}::numeric,
                    backorder_quantity = backorder_quantity + ${backorderQty}::numeric,
                    version = version + 1
                WHERE id = ${inventoryRow.id}
                  AND version = ${inventoryVersion}`,
          );
        }
      }

      // ── Step 21: Generate order reference ───────────────────────────
      const orderReference = `RDM-${Date.now().toString(36).toUpperCase().slice(0, 8)}-${memberId.slice(0, 8).toUpperCase()}`;

      // ── Step 22: Build snapshots ─────────────────────────────────────
      const itemSnapshot: Record<string, unknown> = {
        id: quote.catalog_item_id,
        name: quote.item_name,
        sku: quote.item_sku,
        itemType: quote.item_type,
        fiatReferenceValue: quote.fiat_reference_value,
        fiatCurrency: quote.fiat_currency,
        shippingFee,
        version: Number(quote.catalog_version),
      };
      const rateSnapshot = quote.rate_snapshot as Record<string, unknown>;

      // ── Step 23: INSERT redemption_order ──────────────────────────────
      const orderStatus = isBackordered ? 'BACKORDERED' : 'CONFIRMED';
      const confirmedAt = new Date().toISOString();
      const termsAcceptedAt = new Date().toISOString();
      const orderResult = await tx.execute(
        sql`INSERT INTO redemption_orders (
            order_reference, market_id, member_id, item_id,
            wallet_account_id, wallet_entry_id, quote_id,
            rate_version_id, rate_value, status,
            unrounded_point_cost, posted_point_cost,
            total_points, quantity, backorder_quantity,
            rounding_mode, calculation_scale, posting_scale,
            item_snapshot, rate_snapshot,
            idempotency_key, notes,
            terms_version, terms_accepted_at, confirmed_at
          ) VALUES (
            ${orderReference}, ${marketId}, ${memberId}, ${quote.catalog_item_id},
            ${wallet.id}, ${walletEntryId}, ${quote.id},
            ${quote.rate_version_id}, ${rateVersion.rate_value},
            ${orderStatus}::redemption_order_status,
            ${quote.unrounded_point_cost}, ${quote.posted_point_cost},
            ${quoteTotalPoints}, ${requestedQty}::numeric, ${backorderQuantity}::numeric,
            'HALF_UP', 10, 10,
            ${JSON.stringify(itemSnapshot)}, ${JSON.stringify(rateSnapshot)},
            ${idempotencyKey}, NULL,
            ${input.termsAcceptance.termsVersion}, ${termsAcceptedAt}, ${confirmedAt}
          ) RETURNING *`,
      );
      const orderRow = orderResult.rows[0];
      if (!orderRow)
        throw new RedemptionError(
          'REDEMPTION_ORDER_CREATE_FAILED',
          'Order creation failed',
        );
      recoveryOrderId = orderRow.id as string;

      // ── Step 24: INSERT fulfilment record ─────────────────────────────
      const fulfilmentMode = quote.fulfilment_mode as string;
      const mappedFulfilmentType =
        fulfilmentMode === 'DIGITAL'
          ? 'DIGITAL'
          : fulfilmentMode === 'SERVICE'
            ? 'SERVICE'
            : 'PHYSICAL';

      const shippingAddress = input.fulfilment.deliveryAddress
        ? JSON.stringify(input.fulfilment.deliveryAddress)
        : null;

      await tx.execute(
        sql`INSERT INTO redemption_fulfilments (
            order_id, fulfilment_type, status, shipping_address
          ) VALUES (
            ${orderRow.id},
            ${mappedFulfilmentType}::redemption_fulfilment_type,
            'PENDING'::redemption_fulfilment_status,
            ${shippingAddress}
          )`,
      );

      // ── Step 25: Mark quote consumed — append-only, so consumed_at
      // is tracked via order existence in Step 3 above

      // ── Step 26: Link shipping payment to order (if delivery) ──────
      if (shippingPayment && input.fulfilment.type === 'DELIVERY') {
        const consumePaymentResult = await tx.execute(
          sql`UPDATE redemption_shipping_payments
              SET order_id = ${orderRow.id},
                  consumed_at = NOW(),
                  updated_at = NOW()
              WHERE id = ${input.shippingPaymentIntentReference}
                AND order_id IS NULL
                AND consumed_at IS NULL
              RETURNING id`,
        );
        if (consumePaymentResult.rows.length !== 1) {
          throw new RedemptionError(
            'REDEMPTION_SHIPPING_PAYMENT_MISMATCH',
            'Shipping payment was consumed concurrently.',
            { paymentId: input.shippingPaymentIntentReference },
          );
        }
        shippingPaymentConsumed = true;
      }

      // ── Step 27: INSERT audit log entry ──────────────────────────────
      await tx.execute(
        sql`INSERT INTO redemption_audit_log (
            actor_type, actor_id, market_id, action,
            entity_type, entity_id, after, result, request_id, ip_address
          ) VALUES (
            'MEMBER', ${memberId}, ${marketId}, 'ORDER_CONFIRMED',
            'REDEMPTION_ORDER', ${orderRow.id},
            ${JSON.stringify({
              orderReference,
              status: orderStatus,
              totalPoints: quoteTotalPoints,
              walletEntryId,
              isBackordered,
            })},
            'SUCCESS', ${meta.requestId ?? null}, ${meta.ipAddress ?? null}
          )`,
      );

      // ── Step 28: Record terms acceptance ────────────────────────────
      await tx.execute(
        sql`INSERT INTO redemption_terms_acceptances (
            order_id, member_id, market_id, terms_version,
            accepted_at, request_id, ip_address, user_agent
          ) VALUES (
            ${orderRow.id}, ${memberId}, ${marketId},
            ${input.termsAcceptance.termsVersion}, ${termsAcceptedAt},
            ${meta.requestId ?? null}, ${meta.ipAddress ?? null}, NULL
          )
          ON CONFLICT DO NOTHING`,
      );

      return this.mapOrderToResponse(orderRow);
    });

    return confirmation.catch(async (error: unknown) => {
      if (
        shippingPaymentConsumed &&
        recoveryPayment !== null &&
        recoveryOrderId !== null
      ) {
        await this.recoverConsumedShippingPayment(
          recoveryPayment,
          recoveryOrderId,
          memberId,
          marketId,
          error,
          meta,
        );
      }
      throw error;
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SHIPPING COST & PAYMENT (P6-S3)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Calculate shipping cost for a fulfilment mode.
   * - PICKUP: shipping fee = 0
   * - DELIVERY: shipping fee calculated (CONFIGURABLE) per market
   */
  private async recoverConsumedShippingPayment(
    payment: Record<string, unknown>,
    orderId: string,
    memberId: string,
    marketId: string,
    confirmError: unknown,
    meta: { ipAddress?: string; requestId?: string; userAgent?: string | null },
  ): Promise<void> {
    const paymentId = payment.id as string;
    const providerIntentId = payment.payment_intent_id as string;
    const confirmFailureReason = this.errorMessage(confirmError);
    let recoveryStatus = 'VOIDED';
    let recoveryFailureReason: string | null = null;

    try {
      await this.paymentAdapter.voidIntent({
        providerIntentId,
        paymentId,
        reason: `Order confirmation failed: ${confirmFailureReason}`,
      });
    } catch (voidError) {
      recoveryStatus = 'PENDING';
      recoveryFailureReason = this.errorMessage(voidError);
      this.logger.error(
        { voidError, paymentId, orderId },
        'Failed to void shipping payment after order confirmation failure',
      );
    }

    try {
      await this.database.db.execute(
        sql`INSERT INTO redemption_shipping_payment_recovery (
            order_id, payment_intent_id, payment_method, amount, currency,
            recovery_status, failure_reason, retry_count, max_retries,
            voided_at
          ) VALUES (
            ${orderId}, ${providerIntentId},
            ${(payment.payment_method as string | null) ?? null},
            ${payment.amount as string}, ${payment.currency as string},
            ${recoveryStatus}::redemption_shipping_payment_recovery_status,
            ${recoveryFailureReason ?? confirmFailureReason},
            0, 3,
            ${recoveryStatus === 'VOIDED' ? sql`NOW()` : null}
          )
          ON CONFLICT (order_id) DO NOTHING`,
      );
    } catch (recoveryError) {
      this.logger.error(
        { recoveryError, paymentId, orderId },
        'Failed to persist shipping payment recovery record',
      );
      await this.writeShippingRecoveryFailureAudit(
        paymentId,
        memberId,
        marketId,
        this.errorMessage(recoveryError),
        meta,
      );
      throw new RedemptionError(
        'REDEMPTION_SHIPPING_PAYMENT_RECOVERY_FAILED',
        'Shipping payment recovery could not be persisted.',
        { paymentId, orderId },
      );
    }

    if (recoveryFailureReason !== null) {
      await this.writeShippingRecoveryFailureAudit(
        paymentId,
        memberId,
        marketId,
        recoveryFailureReason,
        meta,
      );
    }
  }

  private async writeShippingRecoveryFailureAudit(
    paymentId: string,
    memberId: string,
    marketId: string,
    reason: string,
    meta: { ipAddress?: string; requestId?: string; userAgent?: string | null },
  ): Promise<void> {
    try {
      await this.database.db.execute(
        sql`INSERT INTO redemption_audit_log (
            actor_type, actor_id, market_id, action,
            entity_type, entity_id, reason, result, request_id, ip_address
          ) VALUES (
            'MEMBER', ${memberId}, ${marketId},
            'SHIPPING_PAYMENT_RECOVERY_FAILED',
            'REDEMPTION_SHIPPING_PAYMENT', ${paymentId},
            ${reason}, 'FAILURE', ${meta.requestId ?? null},
            ${meta.ipAddress ?? null}
          )`,
      );
    } catch (auditError) {
      this.logger.error(
        { auditError, paymentId },
        'Failed to write shipping payment recovery failure audit',
      );
      throw new RedemptionError(
        'REDEMPTION_SHIPPING_PAYMENT_RECOVERY_FAILED',
        'Shipping payment recovery failure audit could not be persisted.',
        { paymentId },
      );
    }
  }

  async calculateShippingCost(
    marketId: string,
    _itemId: string,
    fulfilmentMode: string,
  ): Promise<ShippingCostResponse> {
    if (fulfilmentMode === 'PICKUP') {
      return {
        fulfilmentMode: 'PICKUP',
        shippingFee: '0',
        currency: '',
        isFree: true,
      };
    }

    const marketCurrency = await this.getMarketCurrency(marketId);
    const shippingFee = this.getShippingFee(marketId);
    return {
      fulfilmentMode: 'DELIVERY',
      shippingFee,
      currency: marketCurrency,
      isFree: Number(shippingFee) === 0,
    };
  }

  /**
   * Create a shipping payment intent for delivery orders.
   * The payment is bound to member, quote, market, amount, currency and
   * request hash before an order exists. confirmOrder atomically consumes it.
   */
  async createShippingPayment(
    memberId: string,
    marketId: string,
    quoteId: string,
    input: {
      amount: string;
      currency: string;
      requestHash: string;
      idempotencyKey: string;
    },
  ): Promise<{ paymentId: string; status: string }> {
    const db = this.database.db;
    const lockKey = this.hashKeyToBigInt(
      `shipping-payment:${input.idempotencyKey}`,
    );

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      const existingResult = await tx.execute(
        sql`SELECT * FROM redemption_shipping_payments
            WHERE idempotency_key = ${input.idempotencyKey}`,
      );
      const existing = existingResult.rows[0];
      if (existing) {
        const sameRequest =
          existing.member_id === memberId &&
          existing.market_id === marketId &&
          existing.quote_id === quoteId &&
          this.equalDecimal(existing.amount as string, input.amount) &&
          existing.currency === input.currency &&
          existing.request_hash === input.requestHash;
        if (!sameRequest) {
          throw new RedemptionError(
            'REDEMPTION_IDEMPOTENCY_MISMATCH',
            'This idempotency key was already used for a different shipping payment request.',
            { idempotencyKey: input.idempotencyKey },
          );
        }
        return {
          paymentId: existing.id as string,
          status: existing.status as string,
        };
      }

      const quoteResult = await tx.execute(
        sql`SELECT q.*
            FROM redemption_quotes q
            WHERE q.id = ${quoteId}
              AND q.consumed_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM redemption_orders o WHERE o.quote_id = q.id
              )
            FOR UPDATE`,
      );
      const quote = quoteResult.rows[0];
      if (!quote) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_NOT_FOUND',
          'Quote not found or already consumed.',
          { quoteId },
        );
      }
      if (quote.member_id !== memberId) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_NOT_FOUND',
          'Quote does not belong to this member.',
          { quoteId },
        );
      }
      if (quote.market_id !== marketId) {
        throw new RedemptionError(
          'REDEMPTION_MARKET_MISMATCH',
          'Quote does not belong to the current market.',
          { quoteId, marketId },
        );
      }
      if (new Date(quote.expires_at as string) < new Date()) {
        throw new RedemptionError(
          'REDEMPTION_QUOTE_EXPIRED',
          'Quote has expired. Please generate a new quote.',
          { quoteId },
        );
      }

      const expectedAmount = this.getShippingFee(marketId);
      const marketResult = await tx.execute(
        sql`SELECT currency_code FROM markets WHERE id = ${marketId}`,
      );
      const expectedCurrency = marketResult.rows[0]?.currency_code as
        | string
        | undefined;
      if (!expectedCurrency) {
        throw new RedemptionError(
          'REDEMPTION_MARKET_NOT_FOUND',
          'Shipping payment market currency could not be resolved.',
          { marketId },
        );
      }
      const expectedHash = this.shippingPaymentRequestHash(
        memberId,
        marketId,
        quoteId,
        expectedAmount,
        expectedCurrency,
      );
      if (
        !this.equalDecimal(input.amount, expectedAmount) ||
        input.currency !== expectedCurrency ||
        input.requestHash !== expectedHash
      ) {
        throw new RedemptionError(
          'REDEMPTION_SHIPPING_PAYMENT_MISMATCH',
          'Shipping payment details do not match the server-calculated quote.',
          { quoteId },
        );
      }

      const paymentRequest: PaymentIntentRequest = {
        memberId,
        marketId,
        quoteId,
        currency: input.currency,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        description: `Shipping for redemption quote ${quoteId}`,
      };

      let paymentIntent: Awaited<
        ReturnType<ShippingPaymentAdapter['createIntent']>
      >;
      try {
        paymentIntent = await this.paymentAdapter.createIntent(paymentRequest);
      } catch (error) {
        this.logger.error(
          { error, quoteId },
          'Failed to create shipping payment intent',
        );
        throw new RedemptionError(
          'REDEMPTION_SHIPPING_PAYMENT_FAILED',
          'Failed to create shipping payment. Please try again.',
          { quoteId },
        );
      }

      if (
        !this.equalDecimal(paymentIntent.amount, input.amount) ||
        paymentIntent.currency !== input.currency
      ) {
        throw new RedemptionError(
          'REDEMPTION_SHIPPING_ADAPTER_ERROR',
          'Payment provider returned mismatched shipping payment details.',
          { quoteId },
        );
      }

      const paymentResult = await tx.execute(
        sql`INSERT INTO redemption_shipping_payments (
            order_id, member_id, quote_id, market_id,
            amount, currency, request_hash,
            status, payment_provider, payment_intent_id,
            idempotency_key
          ) VALUES (
            NULL, ${memberId}, ${quoteId}, ${marketId},
            ${input.amount}, ${input.currency}, ${input.requestHash},
            'PENDING'::redemption_shipping_payment_status,
            ${paymentIntent.provider}, ${paymentIntent.providerIntentId},
            ${input.idempotencyKey}
          )
          RETURNING id, status`,
      );
      const payment = paymentResult.rows[0];
      if (!payment) {
        throw new RedemptionError(
          'REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND',
          'Failed to create shipping payment record.',
          { quoteId },
        );
      }

      return {
        paymentId: payment.id as string,
        status: payment.status as string,
      };
    });
  }

  /**
   * Confirm a shipping payment after the frontend completes payment.
   * On confirm failure: auto-void the payment intent.
   * Canonical: uses status enum, payment_provider, payment_intent_id.
   */
  async confirmShippingPayment(
    paymentId: string,
    providerIntentId: string,
  ): Promise<{ status: string }> {
    const db = this.database.db;

    const paymentResult = await db.execute(
      sql`SELECT * FROM redemption_shipping_payments
          WHERE id = ${paymentId} AND status != 'REFUNDED'::redemption_shipping_payment_status`,
    );
    const payment = paymentResult.rows[0];
    if (!payment) {
      throw new RedemptionError(
        'REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND',
        'Shipping payment not found.',
        { paymentId },
      );
    }

    try {
      await this.paymentAdapter.confirmIntent({
        providerIntentId,
        paymentId,
      });
      await db.execute(
        sql`UPDATE redemption_shipping_payments
            SET status = 'PAID'::redemption_shipping_payment_status,
                paid_at = NOW()
            WHERE id = ${paymentId}`,
      );
      return { status: 'PAID' };
    } catch (error) {
      this.logger.error(
        { error, paymentId, providerIntentId },
        'Shipping payment confirmation failed',
      );

      // Auto-void on confirmation failure
      try {
        await this.paymentAdapter.voidIntent({
          providerIntentId,
          paymentId,
          reason: 'Confirmation failed',
        });
      } catch (voidError) {
        this.logger.error(
          { voidError, paymentId },
          'Failed to void shipping payment after confirm failure',
        );
      }

      await db.execute(
        sql`UPDATE redemption_shipping_payments
            SET status = 'FAILED'::redemption_shipping_payment_status,
                failed_at = NOW()
            WHERE id = ${paymentId}`,
      );
      throw new RedemptionError(
        'REDEMPTION_SHIPPING_PAYMENT_FAILED',
        'Shipping payment confirmation failed.',
        { paymentId },
      );
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // DECIMAL ARITHMETIC HELPERS
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Compute point cost using rate conversion (OD-21).
   * required_iPoint = fiat_reference_value / redemption_rate
   * Uses BigInt-based scaling for precision.
   */
  private computePointCost(fiatValue: string, rate: string): string {
    const scale = 10n ** 10n;
    const fiatBig = BigInt(this.toBigIntStr(fiatValue, 10));
    const rateBig = BigInt(this.toBigIntStr(rate, 10));
    if (rateBig === 0n) return '0';
    const result = (fiatBig * scale) / rateBig;
    return this.fromBigIntStr(result, 10);
  }

  private multiplyDecimal(a: string, b: string): string {
    const aBig = BigInt(this.toBigIntStr(a, 10));
    const bBig = BigInt(b);
    return this.fromBigIntStr(aBig * bBig, 10);
  }

  /**
   * HALF_UP rounding: rounds to the specified number of decimal places.
   */
  private roundHalfUp(value: string, scale: number): string {
    const parts = value.split('.');
    const intPart = parts[0] ?? '0';
    const fracPart = (parts[1] ?? '')
      .padEnd(scale + 1, '0')
      .slice(0, scale + 1);

    // Split at rounding boundary
    const keep = fracPart.slice(0, scale);
    const checkDigit = fracPart.slice(scale, scale + 1);

    // Build integer: intPart + keep as bigint
    const unscaled = BigInt(intPart + keep.padEnd(scale, '0'));
    const halfUnit = BigInt('5' + '0'.repeat(scale - 1));
    const adjusted = checkDigit >= '5' ? unscaled + halfUnit : unscaled;

    return this.fromBigIntStr(adjusted, scale);
  }

  private hashPayload(data: Record<string, unknown>): string {
    const json = JSON.stringify(data, Object.keys(data).sort());
    return createHash('sha256').update(json).digest('hex');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private shippingPaymentRequestHash(
    memberId: string,
    marketId: string,
    quoteId: string,
    amount: string,
    currency: string,
  ): string {
    return this.hashPayload({
      memberId,
      quoteId,
      marketId,
      amount,
      currency,
    });
  }

  /**
   * Hash a string key to a non-negative BigInt for pg_advisory_xact_lock.
   * Uses first 8 bytes of SHA-256 to produce a 64-bit integer, ensures non-negative.
   */
  private hashKeyToBigInt(key: string): bigint {
    const hash = createHash('sha256').update(key).digest();
    // Read first 8 bytes as unsigned big-endian bigint
    const buf = hash.subarray(0, 8);
    let result = 0n;
    for (const byte of buf) {
      result = (result << 8n) + BigInt(byte);
    }
    // Ensure non-negative (bit 63 is 0)
    return result & 0x7fffffffffffffffn;
  }

  /**
   * Compare two decimal strings: returns true if a >= b
   */
  private gteDecimal(a: string, b: string): boolean {
    // Compare via BigInt scaling
    const [aInt, aFrac = ''] = a.split('.');
    const [bInt, bFrac = ''] = b.split('.');
    const maxFrac = Math.max(aFrac.length, bFrac.length);
    const aScaled = BigInt(aInt + aFrac.padEnd(maxFrac, '0'));
    const bScaled = BigInt(bInt + bFrac.padEnd(maxFrac, '0'));
    return aScaled >= bScaled;
  }

  private equalDecimal(a: string, b: string): boolean {
    return this.gteDecimal(a, b) && this.gteDecimal(b, a);
  }

  /**
   * Convert a decimal string to a scaled BigInt representation.
   * Example: "12.345" with scale 2 → "12345"
   */
  private decimalToBigInt(value: string, scale: number): bigint {
    const parts = value.split('.');
    const intPart = parts[0] ?? '0';
    const fracPart = (parts[1] ?? '').padEnd(scale, '0').slice(0, scale);
    return BigInt(intPart + fracPart);
  }

  /**
   * Convert a scaled BigInt back to a decimal string.
   */
  private bigIntToDecimal(value: bigint, scale: number): string {
    const str = value.toString();
    const sign = str.startsWith('-') ? '-' : '';
    const abs = str.startsWith('-') ? str.slice(1) : str;
    const padded = abs.padStart(scale + 1, '0');
    const intPart = padded.slice(0, padded.length - scale) || '0';
    const fracPart = padded.slice(padded.length - scale);
    return `${sign}${intPart}.${fracPart}`;
  }

  /**
   * Add two decimal strings (in-memory).
   */
  private addDecimal(a: string, b: string): string {
    const scale = 10;
    const aBig = this.decimalToBigInt(a, scale);
    const bBig = this.decimalToBigInt(b, scale);
    return this.bigIntToDecimal(aBig + bBig, scale);
  }

  /**
   * Subtract two decimal strings: a - b.
   */
  private subtractDecimal(a: string, b: string): string {
    const scale = 10;
    const aBig = this.decimalToBigInt(a, scale);
    const bBig = this.decimalToBigInt(b, scale);
    return this.bigIntToDecimal(aBig - bBig, scale);
  }

  /**
   * Negate a decimal string.
   */
  private negateDecimal(a: string): string {
    if (a.startsWith('-')) return a.slice(1);
    return `-${a}`;
  }

  /**
   * Return the maximum of two decimal strings.
   */
  private maxDecimal(a: string, b: string): string {
    return this.gteDecimal(a, b) ? a : b;
  }

  /**
   * Compare two decimal strings: returns true if a < b.
   */
  private ltDecimal(a: string, b: string): boolean {
    return !this.gteDecimal(a, b);
  }

  /**
   * Map a raw DB row from redemption_orders to RedemptionOrderResponse.
   */
  private mapOrderToResponse(
    row: Record<string, unknown>,
  ): RedemptionOrderResponse {
    return {
      id: row.id as string,
      orderReference: row.order_reference as string,
      marketId: row.market_id as string,
      memberId: row.member_id as string,
      itemId: row.item_id as string,
      walletAccountId: row.wallet_account_id as string,
      walletEntryId: row.wallet_entry_id as string,
      quoteId: row.quote_id as string,
      status: row.status as string,
      totalPointCost: row.total_points as string,
      quantity: row.quantity as string,
      backorderQuantity: row.backorder_quantity as string,
      itemSnapshot: row.item_snapshot as Record<string, unknown>,
      rateSnapshot: row.rate_snapshot as Record<string, unknown>,
      idempotencyKey: (row.idempotency_key as string) ?? null,
      confirmedAt: new Date(row.confirmed_at as string).toISOString(),
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  private async getMarketCurrency(marketId: string): Promise<string> {
    const db = this.database.db;
    const result = await db.execute(
      sql`SELECT currency_code FROM markets WHERE id = ${marketId}`,
    );
    return (result.rows[0]?.currency_code as string) ?? 'MYR';
  }

  /**
   * Get the shipping fee configuration for a market.
   * CONFIGURABLE — not hard-coded.
   * MVP uses default flat rate: RM 10.
   * Override via REDEMPTION_SHIPPING_FEE_{MARKET_ID} env var.
   */
  private getShippingFee(marketId: string): string {
    const envKey = `REDEMPTION_SHIPPING_FEE_${marketId.toUpperCase().replace(/-/g, '_')}`;
    const configuredFee =
      process.env[envKey] ?? process.env['REDEMPTION_SHIPPING_FEE_DEFAULT'];
    if (configuredFee) return configuredFee;
    return '10.00'; // Default flat rate
  }

  // ═════════════════════════════════════════════════════════════════════════
  // RESPONSE MAPPERS — Canonical Column Mapping
  // ═════════════════════════════════════════════════════════════════════════

  private toCatalogItem(row: Record<string, unknown>): RedemptionCatalogItem {
    return {
      id: row.id as string,
      marketId: row.market_id as string,
      sku: (row.sku as string) ?? null,
      name: row.name as string,
      description: (row.description as string) ?? null,
      itemType: row.item_type as string,
      ownership: (row.ownership as string) ?? 'PLATFORM_OWNED',
      status: row.status as string,
      fiatReferenceValue: row.fiat_reference_value as string,
      fiatCurrency: row.fiat_currency as string,
      fulfilmentMode: row.fulfilment_mode as string,
      inventoryMode: row.inventory_mode as string,
      imageUrl: (row.image_url as string) ?? null,
      terms: (row.terms as string) ?? null,
      isFeatured: row.is_featured as boolean,
      tags: (row.tags as string[]) ?? [],
      sortOrder: Number(row.sort_order),
      effectiveFrom: new Date(row.effective_from as string).toISOString(),
      effectiveUntil: row.effective_until
        ? new Date(row.effective_until as string).toISOString()
        : null,
      version: Number(row.version),
      createdBy: row.created_by as string,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }

  private toRateVersion(row: Record<string, unknown>): RedemptionRateVersion {
    return {
      id: row.id as string,
      marketId: row.market_id as string,
      rateType: row.rate_type as string,
      rateValue: row.rate_value as string,
      effectiveFrom: new Date(row.effective_from as string).toISOString(),
      effectiveUntil: row.effective_until
        ? new Date(row.effective_until as string).toISOString()
        : null,
      status: 'ACTIVE',
      createdBy: row.created_by as string,
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  private toPickupLocation(
    row: Record<string, unknown>,
  ): RedemptionPickupLocation {
    const addr = row.address as Record<string, unknown> | null;
    return {
      id: row.id as string,
      marketId: row.market_id as string,
      name: row.name as string,
      address: addr ?? {},
      contactName: (row.contact_name as string) ?? null,
      contactPhone: (row.contact_phone as string) ?? null,
      operatingHours: (row.operating_hours as Record<string, unknown>) ?? {},
      isActive: row.is_active as boolean,
      createdBy: row.created_by as string,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }

  /**
   * Convert a decimal numeric string to a BigInt-compatible integer string.
   * Handles up to the specified number of decimal places.
   */
  private toBigIntStr(value: string, scale: number): string {
    const parts = value.split('.');
    const intPart = parts[0] ?? '0';
    const fracPart = (parts[1] ?? '').padEnd(scale, '0').slice(0, scale);
    return intPart + fracPart;
  }

  /**
   * Convert a BigInt integer string back to a decimal numeric string.
   */
  private fromBigIntStr(value: bigint | string, scale: number): string {
    const str = typeof value === 'bigint' ? value.toString() : value;
    if (scale === 0) return str;
    const padded = str.padStart(scale + 1, '0');
    const intPart = padded.slice(0, padded.length - scale) || '0';
    const fracPart = padded.slice(padded.length - scale);
    return `${intPart}.${fracPart}`;
  }
}

// ─── D-053 exact-decimal helpers (string only — never float arithmetic) ──

/**
 * Scale a rate decimal string to 10^10 integer units (BigInt).
 * Rejects negative values, missing digits, or more than 10 decimals.
 */
export function scaledRate(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,10}))?$/u.exec(value.trim());
  if (!match) throw redemptionRatePrecisionError();
  const whole = BigInt(match[1] ?? '0');
  const fraction = (match[2] ?? '').padEnd(10, '0') || '0';
  return whole * REDEMPTION_RATE_SCALE + BigInt(fraction);
}

/**
 * Trim a stored exact-decimal rate to its significant digits for display
 * (string-only formatting — no arithmetic). Storage keeps `numeric(38,10)`;
 * the display convention is at most six decimals (server-derived, never
 * changing the stored exact value).
 */
export function normalizeRateString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('.')) return trimmed;
  const [whole = '0', fraction] = trimmed.split('.');
  const significant = (fraction ?? '').replace(/0+$/u, '');
  return significant === '' ? whole : `${whole}.${significant}`;
}

// ─── Market-local midnight resolution (IANA timezone, D-053 §7) ──────────

/**
 * Resolve the UTC instant of the market-local midnight of a calendar date
 * in the given IANA timezone. Returns `null` when no unambiguous 00:00:00
 * wall time exists for that date (skipped midnights such as
 * America/Havana spring-forward, or ambiguous repeated midnights such as
 * America/Santiago fall-back, or an invalid/unsupported timezone).
 *
 * Multiple probes across the UTC day are used so a transition that lands
 * between 00:00 and 12:00 local can never hide the pre-transition midnight:
 * the offset observed by at least one probe matches the offset in force at
 * the date's own 00:00.
 */
export function resolveLocalMidnight(
  dateStr: string,
  timeZone: string,
): Date | null {
  try {
    const dateParts = dateStr.split('-').map((value) => Number(value));
    const year = dateParts[0] ?? 0;
    const month = dateParts[1] ?? 0;
    const day = dateParts[2] ?? 0;
    const candidates: number[] = [];
    for (const hour of [0, 6, 12, 18]) {
      const probe = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));
      const probeParts = localParts(probe, timeZone);
      const localAsUtc = Date.UTC(
        probeParts.year,
        probeParts.month - 1,
        probeParts.day,
        probeParts.hour,
        probeParts.minute,
        probeParts.second,
      );
      const offsetMs = localAsUtc - probe.getTime();
      const midnight = new Date(
        Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMs,
      );
      const wall = localParts(midnight, timeZone);
      if (
        wall.year === year &&
        wall.month === month &&
        wall.day === day &&
        wall.hour === 0 &&
        wall.minute === 0 &&
        wall.second === 0
      ) {
        candidates.push(midnight.getTime());
      }
    }
    if (candidates.length === 0) return null;
    const distinct = [...new Set(candidates)];
    if (distinct.length !== 1) return null;
    return new Date(distinct[0] ?? 0);
  } catch {
    // Invalid/unsupported IANA timezone (Intl throws RangeError).
    return null;
  }
}

/**
 * True when the given instant is exactly the market-local 00:00:00 of its
 * own local date in the market timezone (round-trip against
 * `resolveLocalMidnight` so DST edges — skipped or ambiguous midnights —
 * are rejected).
 */
export function isMarketLocalMidnight(at: Date, timeZone: string): boolean {
  if (Number.isNaN(at.getTime())) return false;
  const wall = localParts(at, timeZone);
  if (wall.hour !== 0 || wall.minute !== 0 || wall.second !== 0) return false;
  const dateStr = `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
  const resolved = resolveLocalMidnight(dateStr, timeZone);
  return resolved !== null && resolved.getTime() === at.getTime();
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(at: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = new Map(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(map.get('year') ?? '0'),
    month: Number(map.get('month') ?? '0'),
    day: Number(map.get('day') ?? '0'),
    hour: Number(map.get('hour') ?? '0'),
    minute: Number(map.get('minute') ?? '0'),
    second: Number(map.get('second') ?? '0'),
  };
}

/**
 * Market-local wall clock "YYYY-MM-DD HH:mm:ss" for display.
 */
export function localWallString(at: Date, timeZone: string): string {
  const parts = localParts(at, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
}

/**
 * Market-local calendar date "YYYY-MM-DD" (payload-hash component).
 */
export function localDateString(at: Date, timeZone: string): string {
  const parts = localParts(at, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

// ─── Canonical payload hash (sorted keys + sha256, D-053 §10) ────────────

/**
 * Canonical payload hash for idempotency correlation (owner pattern):
 * keys sorted recursively, then sha256 hex.
 */
export function canonicalPayloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(sortJson(payload)))
    .digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}
