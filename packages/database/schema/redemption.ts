import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  markets,
  members,
  adminUsers,
  memberWalletEntries,
  memberWalletAccounts,
} from './index.js';

const utcTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 6 });

// ── Enums (contract-aligned) ──────────────────────────────────────────

export const redemptionCatalogStatus = pgEnum('redemption_catalog_status', [
  'DRAFT',
  'ACTIVE',
  'DISABLED',
  'ARCHIVED',
]);

export const redemptionItemType = pgEnum('redemption_item_type', [
  'PHYSICAL',
  'DIGITAL_VOUCHER',
  'SERVICE',
]);

export const redemptionOwnership = pgEnum('redemption_ownership', [
  'PLATFORM_OWNED',
]);

export const redemptionFulfilmentMode = pgEnum('redemption_fulfilment_mode', [
  'DELIVERY',
  'PICKUP',
  'DELIVERY_OR_PICKUP',
  'DIGITAL',
  'SERVICE',
]);

export const redemptionInventoryMode = pgEnum('redemption_inventory_mode', [
  'UNLIMITED',
  'TRACKED',
  'ON_DEMAND',
]);

export const redemptionOrderStatus = pgEnum('redemption_order_status', [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'READY_FOR_PICKUP',
  'BACKORDERED',
  'FULFILMENT_SUSPENDED',
  'FULFILMENT_EXCEPTION',
  'REFUND_PENDING',
  'REFUNDED',
  'FULFILLED',
  'CANCELLED',
]);

export const redemptionQuoteStatus = pgEnum('redemption_quote_status', [
  'VALID',
  'EXPIRED',
  'CONSUMED',
]);

export const redemptionWaitlistStatus = pgEnum('redemption_waitlist_status', [
  'ACTIVE',
  'NOTIFIED',
  'EXPIRED',
  'CANCELLED',
]);

export const redemptionFulfilmentType = pgEnum('redemption_fulfilment_type', [
  'PHYSICAL',
  'DIGITAL',
  'SERVICE',
]);

export const redemptionFulfilmentStatus = pgEnum(
  'redemption_fulfilment_status',
  ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
);

export const redemptionRefundRequestStatus = pgEnum(
  'redemption_refund_request_status',
  [
    'PENDING_CHECKER',
    'APPROVED',
    'REJECTED',
    'EXECUTING',
    'COMPLETED',
    'FAILED',
  ],
);

export const redemptionShippingPaymentStatus = pgEnum(
  'redemption_shipping_payment_status',
  ['PENDING', 'PAID', 'FAILED', 'REFUNDED'],
);

export const redemptionRateType = pgEnum('redemption_rate_type', [
  'POINTS_PER_CURRENCY',
  'CURRENCY_PER_POINT',
]);

// ── Tables ────────────────────────────────────────────────────────────

// ─── Redemption Rate Versions ────────────────────────────────────────────

export const redemptionRateVersions = pgTable(
  'redemption_rate_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    rateType: redemptionRateType('rate_type').notNull(),
    rateValue: numeric('rate_value', { precision: 38, scale: 10 }).notNull(),
    effectiveFrom: utcTimestamp('effective_from').notNull(),
    effectiveUntil: utcTimestamp('effective_until'),
    createdBy: uuid('created_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('chk_redemption_rate_value', sql`${table.rateValue} > 0`),
    check(
      'chk_redemption_rate_period',
      sql`${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
    // gist exclusion: no overlapping rate periods per market+rate_type
    index('idx_redemption_rate_active').on(
      table.marketId,
      table.rateType,
      table.effectiveFrom,
    ),
  ],
);

// ─── Redemption Catalog Items ─────────────────────────────────────────────

export const redemptionCatalogItems = pgTable(
  'redemption_catalog_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    sku: varchar('sku', { length: 64 }),
    name: varchar('name', { length: 256 }).notNull(),
    description: text('description'),
    itemType: redemptionItemType('item_type').notNull(),
    ownership: redemptionOwnership('ownership')
      .notNull()
      .default('PLATFORM_OWNED'),
    status: redemptionCatalogStatus('status').notNull().default('DRAFT'),
    fiatReferenceValue: numeric('fiat_reference_value', {
      precision: 38,
      scale: 10,
    }).notNull(),
    fiatCurrency: varchar('fiat_currency', { length: 3 }).notNull(),
    fulfilmentMode: redemptionFulfilmentMode('fulfilment_mode')
      .notNull()
      .default('DELIVERY'),
    inventoryMode: redemptionInventoryMode('inventory_mode')
      .notNull()
      .default('TRACKED'),
    imageUrl: text('image_url'),
    terms: text('terms'),
    isFeatured: boolean('is_featured').notNull().default(false),
    tags: text('tags').array(),
    sortOrder: integer('sort_order').notNull().default(0),
    effectiveFrom: utcTimestamp('effective_from').notNull().defaultNow(),
    effectiveUntil: utcTimestamp('effective_until'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'chk_catalog_fiat_currency',
      sql`char_length(${table.fiatCurrency}) = 3`,
    ),
    check('chk_catalog_fiat_value', sql`${table.fiatReferenceValue} > 0`),
    check('chk_catalog_version', sql`${table.version} > 0`),
    check(
      'chk_catalog_period',
      sql`${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
    uniqueIndex('uq_catalog_sku_market')
      .on(table.marketId, table.sku)
      .where(sql`${table.sku} IS NOT NULL`),
    index('idx_catalog_market_status').on(table.marketId, table.status),
  ],
);

// ─── Redemption Inventory ─────────────────────────────────────────────────

export const redemptionInventory = pgTable(
  'redemption_inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => redemptionCatalogItems.id, { onDelete: 'restrict' }),
    totalQuantity: numeric('total_quantity', { precision: 38, scale: 0 }),
    reservedQuantity: numeric('reserved_quantity', { precision: 38, scale: 0 })
      .notNull()
      .default('0'),
    fulfilledQuantity: numeric('fulfilled_quantity', {
      precision: 38,
      scale: 0,
    })
      .notNull()
      .default('0'),
    backorderQuantity: numeric('backorder_quantity', {
      precision: 38,
      scale: 0,
    })
      .notNull()
      .default('0'),
    version: integer('version').notNull().default(1),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_redemption_inventory_item').on(table.itemId),
    check(
      'chk_inventory_overflow',
      sql`${table.totalQuantity} IS NULL OR (${table.reservedQuantity} + ${table.fulfilledQuantity} + ${table.backorderQuantity} <= ${table.totalQuantity})`,
    ),
    check(
      'chk_inventory_non_negative',
      sql`${table.reservedQuantity} >= 0 AND ${table.fulfilledQuantity} >= 0 AND ${table.backorderQuantity} >= 0`,
    ),
    check('chk_inventory_version', sql`${table.version} > 0`),
  ],
);

// ─── Redemption Quotes ────────────────────────────────────────────────────

export const redemptionQuotes = pgTable(
  'redemption_quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => redemptionCatalogItems.id, { onDelete: 'restrict' }),
    status: redemptionQuoteStatus('status').notNull().default('VALID'),
    rateVersionId: uuid('rate_version_id')
      .notNull()
      .references(() => redemptionRateVersions.id, { onDelete: 'restrict' }),
    rateSnapshot: jsonb('rate_snapshot').notNull(),
    unroundedPointCost: numeric('unrounded_point_cost', {
      precision: 38,
      scale: 10,
    }).notNull(),
    postedPointCost: numeric('posted_point_cost', {
      precision: 38,
      scale: 10,
    }).notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    consumedAt: utcTimestamp('consumed_at'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'chk_quote_point_cost',
      sql`${table.unroundedPointCost} > 0 AND ${table.postedPointCost} > 0`,
    ),
    check('chk_quote_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'chk_quote_payload_hash',
      sql`char_length(${table.payloadHash}) = 64`,
    ),
    uniqueIndex('uq_quote_idempotency').on(table.idempotencyKey),
    index('idx_quote_member_valid').on(table.memberId, table.status),
  ],
);

// ─── Redemption Orders ────────────────────────────────────────────────────

export const redemptionOrders = pgTable(
  'redemption_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderReference: varchar('order_reference', { length: 64 }).notNull(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => redemptionCatalogItems.id, { onDelete: 'restrict' }),
    walletAccountId: uuid('wallet_account_id')
      .notNull()
      .references(() => memberWalletAccounts.id, { onDelete: 'restrict' }),
    walletEntryId: uuid('wallet_entry_id').references(
      () => memberWalletEntries.id,
      { onDelete: 'restrict' },
    ),
    quoteId: uuid('quote_id').references(() => redemptionQuotes.id, {
      onDelete: 'restrict',
    }),
    rateVersionId: uuid('rate_version_id')
      .notNull()
      .references(() => redemptionRateVersions.id, { onDelete: 'restrict' }),
    rateValue: numeric('rate_value', { precision: 38, scale: 10 }).notNull(),
    status: redemptionOrderStatus('status').notNull().default('CONFIRMED'),
    unroundedPointCost: numeric('unrounded_point_cost', {
      precision: 38,
      scale: 10,
    }).notNull(),
    postedPointCost: numeric('posted_point_cost', {
      precision: 38,
      scale: 10,
    }).notNull(),
    totalPoints: numeric('total_points', {
      precision: 38,
      scale: 10,
    }).notNull(),
    quantity: numeric('quantity', { precision: 38, scale: 0 }).notNull(),
    backorderQuantity: numeric('backorder_quantity', {
      precision: 38,
      scale: 0,
    })
      .notNull()
      .default('0'),
    roundingMode: varchar('rounding_mode', { length: 16 })
      .notNull()
      .default('HALF_UP'),
    calculationScale: integer('calculation_scale').notNull().default(10),
    postingScale: integer('posting_scale').notNull().default(10),
    itemSnapshot: jsonb('item_snapshot').notNull(),
    rateSnapshot: jsonb('rate_snapshot').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    notes: text('notes'),
    confirmedAt: utcTimestamp('confirmed_at'),
    processingStartedAt: utcTimestamp('processing_started_at'),
    readyForPickupAt: utcTimestamp('ready_for_pickup_at'),
    backorderedAt: utcTimestamp('backordered_at'),
    fulfilledAt: utcTimestamp('fulfilled_at'),
    cancelledAt: utcTimestamp('cancelled_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_order_reference').on(table.orderReference),
    uniqueIndex('uq_order_idempotency')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex('uq_order_quote')
      .on(table.quoteId)
      .where(sql`${table.quoteId} IS NOT NULL`),
    check('chk_order_total_points', sql`${table.totalPoints} > 0`),
    check('chk_order_quantity', sql`${table.quantity} > 0`),
    check(
      'chk_order_backorder',
      sql`${table.backorderQuantity} >= 0 AND ${table.backorderQuantity} <= ${table.quantity}`,
    ),
    check('chk_order_calc_scale', sql`${table.calculationScale} > 0`),
    check('chk_order_posting_scale', sql`${table.postingScale} > 0`),
    check(
      'chk_order_rounding_mode',
      sql`${table.roundingMode} IN ('HALF_UP', 'HALF_DOWN', 'HALF_EVEN', 'FLOOR', 'CEILING')`,
    ),
    check(
      'chk_order_suspension_notes',
      sql`${table.status} <> 'FULFILMENT_SUSPENDED' OR ${table.notes} IS NOT NULL`,
    ),
    check(
      'chk_order_refund_state',
      sql`(${table.status} = 'REFUND_PENDING' AND ${table.walletEntryId} IS NULL) OR (${table.status} = 'REFUNDED' AND ${table.walletEntryId} IS NOT NULL) OR (${table.status} NOT IN ('REFUND_PENDING', 'REFUNDED'))`,
    ),
    index('idx_order_member').on(table.memberId),
    index('idx_order_status').on(table.status),
  ],
);

// ─── Redemption Fulfilments ───────────────────────────────────────────────

export const redemptionFulfilments = pgTable(
  'redemption_fulfilments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => redemptionOrders.id, { onDelete: 'restrict' }),
    fulfilmentType: redemptionFulfilmentType('fulfilment_type').notNull(),
    status: redemptionFulfilmentStatus('status').notNull().default('PENDING'),
    shippingAddress: jsonb('shipping_address'),
    trackingNumber: varchar('tracking_number', { length: 128 }),
    courier: varchar('courier', { length: 64 }),
    estimatedDeliveryDate: date('estimated_delivery_date'),
    digitalValue: text('digital_value'),
    serviceScheduledAt: utcTimestamp('service_scheduled_at'),
    serviceNotes: text('service_notes'),
    fulfilledAt: utcTimestamp('fulfilled_at'),
    failedAt: utcTimestamp('failed_at'),
    failureReason: text('failure_reason'),
    retryCount: integer('retry_count').notNull().default(0),
    notes: text('notes'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_fulfilment_order').on(table.orderId),
    check('chk_fulfilment_retry', sql`${table.retryCount} >= 0`),
    index('idx_fulfilment_status').on(table.status),
  ],
);

// ─── Redemption Refund Requests ───────────────────────────────────────────

export const redemptionRefundRequests = pgTable(
  'redemption_refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => redemptionOrders.id, { onDelete: 'restrict' }),
    makerId: uuid('maker_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    checkerId: uuid('checker_id').references(() => adminUsers.id, {
      onDelete: 'restrict',
    }),
    status: redemptionRefundRequestStatus('status')
      .notNull()
      .default('PENDING_CHECKER'),
    refundAmount: numeric('refund_amount', {
      precision: 38,
      scale: 10,
    }).notNull(),
    reason: text('reason').notNull(),
    makerNotes: text('maker_notes'),
    checkerNotes: text('checker_notes'),
    walletEntryId: uuid('wallet_entry_id').references(
      () => memberWalletEntries.id,
      { onDelete: 'restrict' },
    ),
    decidedAt: utcTimestamp('decided_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('chk_refund_amount', sql`${table.refundAmount} > 0`),
    check(
      'chk_refund_maker_checker_different',
      sql`${table.checkerId} IS NULL OR ${table.makerId} <> ${table.checkerId}`,
    ),
    check(
      'chk_refund_decided_fields',
      sql`(${table.status} = 'PENDING_CHECKER' AND ${table.checkerId} IS NULL AND ${table.decidedAt} IS NULL AND ${table.walletEntryId} IS NULL) OR (${table.status} = 'APPROVED' AND ${table.checkerId} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND ${table.walletEntryId} IS NOT NULL) OR (${table.status} = 'REJECTED' AND ${table.checkerId} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND ${table.walletEntryId} IS NULL)`,
    ),
    index('idx_refund_order').on(table.orderId),
    index('idx_refund_status').on(table.status),
  ],
);

// ─── Redemption Audit Log ─────────────────────────────────────────────────

export const redemptionAuditLog = pgTable(
  'redemption_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: varchar('actor_type', { length: 32 }).notNull(),
    actorId: uuid('actor_id'),
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    result: varchar('result', { length: 16 }).notNull(),
    requestId: varchar('request_id', { length: 128 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_entity').on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index('idx_audit_actor').on(
      table.actorType,
      table.actorId,
      table.occurredAt,
    ),
  ],
);

// ─── Redemption Pickup Locations ──────────────────────────────────────────

export const redemptionPickupLocations = pgTable(
  'redemption_pickup_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 256 }).notNull(),
    address: jsonb('address').notNull(),
    contactName: varchar('contact_name', { length: 128 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    operatingHours: jsonb('operating_hours'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('chk_pickup_name', sql`char_length(btrim(${table.name})) > 0`),
    index('idx_pickup_market_active').on(table.marketId, table.isActive),
  ],
);

// ─── Redemption Waitlist Entries ─────────────────────────────────────────

export const redemptionWaitlistEntries = pgTable(
  'redemption_waitlist_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => redemptionCatalogItems.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    status: redemptionWaitlistStatus('status').notNull().default('ACTIVE'),
    requestedQuantity: numeric('requested_quantity', {
      precision: 38,
      scale: 0,
    })
      .notNull()
      .default('1'),
    notifiedAt: utcTimestamp('notified_at'),
    expiredAt: utcTimestamp('expired_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_waitlist_member_item').on(
      table.memberId,
      table.catalogItemId,
    ),
    check('chk_waitlist_quantity', sql`${table.requestedQuantity} > 0`),
    index('idx_waitlist_item_active')
      .on(table.catalogItemId, table.status)
      .where(sql`${table.status} = 'ACTIVE'`),
  ],
);

// ─── Redemption Voucher Codes ─────────────────────────────────────────────

export const redemptionVoucherCodes = pgTable(
  'redemption_voucher_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => redemptionOrders.id, { onDelete: 'restrict' }),
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => redemptionCatalogItems.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    codeEncrypted: text('code_encrypted').notNull(),
    expiryDate: date('expiry_date'),
    usedAt: utcTimestamp('used_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_voucher_code_hash').on(table.codeHash),
    check('chk_voucher_code_hash', sql`char_length(${table.codeHash}) = 64`),
    index('idx_voucher_order').on(table.orderId),
  ],
);

// ─── Redemption Shipping Payments ─────────────────────────────────────────

export const redemptionShippingPayments = pgTable(
  'redemption_shipping_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => redemptionOrders.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: redemptionShippingPaymentStatus('status')
      .notNull()
      .default('PENDING'),
    paymentProvider: varchar('payment_provider', { length: 64 }),
    paymentIntentId: varchar('payment_intent_id', { length: 128 }),
    paymentMethod: varchar('payment_method', { length: 64 }),
    paidAt: utcTimestamp('paid_at'),
    failedAt: utcTimestamp('failed_at'),
    refundedAt: utcTimestamp('refunded_at'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_shipping_order').on(table.orderId),
    check('chk_shipping_amount', sql`${table.amount} > 0`),
    check('chk_shipping_currency', sql`char_length(${table.currency}) = 3`),
    index('idx_shipping_order').on(table.orderId),
  ],
);

// ─── Redemption Terms Acceptances ─────────────────────────────────────────

export const redemptionTermsAcceptances = pgTable(
  'redemption_terms_acceptances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    termsVersion: varchar('terms_version', { length: 64 }).notNull(),
    acceptedAt: utcTimestamp('accepted_at').notNull().defaultNow(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('uq_redemption_terms').on(
      table.memberId,
      table.marketId,
      table.termsVersion,
    ),
    index('idx_redemption_terms_member').on(table.memberId),
  ],
);

// ─── Exception Severity (contract-aligned) ──────────────────────────────────

export const redemptionExceptionSeverity = pgEnum(
  'redemption_exception_severity',
  ['RETRYABLE', 'NON_RETRYABLE'],
);

// ─── Shipping Payment Recovery Status (contract-aligned) ─────────────────────

export const redemptionShippingPaymentRecoveryStatus = pgEnum(
  'redemption_shipping_payment_recovery_status',
  ['PENDING', 'VOIDING', 'VOIDED', 'REFUNDING', 'REFUNDED', 'FAILED'],
);

// ─── Redemption Fulfilment Exceptions ────────────────────────────────────────

export const redemptionFulfilmentExceptions = pgTable(
  'redemption_fulfilment_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fulfilmentId: uuid('fulfilment_id')
      .notNull()
      .references(() => redemptionFulfilments.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').notNull(),
    severity: redemptionExceptionSeverity('severity').notNull(),
    retryAttempt: integer('retry_attempt').notNull().default(0),
    errorCode: text('error_code').notNull(),
    errorMessage: text('error_message').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    resolvedBy: uuid('resolved_by').references(() => adminUsers.id, {
      onDelete: 'restrict',
    }),
    resolvedAt: utcTimestamp('resolved_at'),
    resolutionNotes: text('resolution_notes'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('chk_exception_retry_attempt', sql`${table.retryAttempt} >= 0`),
    index('idx_exception_fulfilment').on(table.fulfilmentId),
    index('idx_exception_unresolved').on(table.resolved, table.createdAt),
  ],
);

// ─── Redemption Fulfilment Audit ────────────────────────────────────────────

export const redemptionFulfilmentAudit = pgTable(
  'redemption_fulfilment_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull(),
    fulfilmentId: uuid('fulfilment_id').references(
      () => redemptionFulfilments.id,
      { onDelete: 'restrict' },
    ),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_order').on(table.orderId, table.occurredAt),
    index('idx_audit_fulfilment').on(table.fulfilmentId, table.occurredAt),
  ],
);

// ─── Redemption Shipping Payment Recovery (OD-07) ───────────────────────────

export const redemptionShippingPaymentRecovery = pgTable(
  'redemption_shipping_payment_recovery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => redemptionOrders.id, { onDelete: 'restrict' }),
    paymentIntentId: text('payment_intent_id').notNull(),
    paymentMethod: text('payment_method'),
    amount: numeric('amount', { precision: 38, scale: 10 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    recoveryStatus: redemptionShippingPaymentRecoveryStatus('recovery_status')
      .notNull()
      .default('PENDING'),
    failureReason: text('failure_reason'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    voidedAt: utcTimestamp('voided_at'),
    refundedAt: utcTimestamp('refunded_at'),
    failedAt: utcTimestamp('failed_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('chk_recovery_amount', sql`${table.amount} > 0`),
    check('chk_recovery_retry', sql`${table.retryCount} >= 0`),
    index('idx_recovery_status').on(table.recoveryStatus),
  ],
);
