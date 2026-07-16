import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const marketStatus = pgEnum('market_status', ['ACTIVE', 'SUSPENDED']);
export const walletStatus = pgEnum('wallet_status', [
  'ACTIVE',
  'FROZEN',
  'CLOSED',
]);
export const ledgerDirection = pgEnum('ledger_direction', ['CREDIT', 'DEBIT']);
export const adjustmentStatus = pgEnum('adjustment_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
]);
export const adjustmentActionType = pgEnum('adjustment_action_type', [
  'APPROVE',
  'REJECT',
  'EXECUTE',
]);
export const ruleStatus = pgEnum('rule_status', ['DRAFT', 'ACTIVE', 'RETIRED']);
export const idempotencyStatus = pgEnum('idempotency_status', [
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

const utcTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 6, mode: 'date' });

export const markets = pgTable('markets', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicId: varchar('public_id', { length: 32 })
    .notNull()
    .unique('markets_public_id_key'),
  code: varchar('code', { length: 16 }).notNull().unique('markets_code_key'),
  currency: char('currency', { length: 3 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  status: marketStatus('status').notNull().default('ACTIVE'),
  createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
});

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: varchar('public_id', { length: 40 })
      .notNull()
      .unique('wallets_public_id_key'),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    ownerType: varchar('owner_type', { length: 32 }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    balance: numeric('balance', { precision: 24, scale: 8 })
      .notNull()
      .default('0'),
    version: integer('version').notNull().default(0),
    status: walletStatus('status').notNull().default('ACTIVE'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('wallets_market_owner_currency_key').on(
      table.marketId,
      table.ownerType,
      table.ownerId,
      table.currency,
    ),
    index('wallets_market_status_idx').on(table.marketId, table.status),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: varchar('public_id', { length: 48 })
      .notNull()
      .unique('ledger_entries_public_id_key'),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    direction: ledgerDirection('direction').notNull(),
    amount: numeric('amount', { precision: 24, scale: 8 }).notNull(),
    entryType: varchar('entry_type', { length: 48 }).notNull(),
    sourceType: varchar('source_type', { length: 48 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    balanceAfter: numeric('balance_after', {
      precision: 24,
      scale: 8,
    }).notNull(),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    reversalOfEntryId: uuid('reversal_of_entry_id').references(
      (): AnyPgColumn => ledgerEntries.id,
      { onDelete: 'restrict', onUpdate: 'cascade' },
    ),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [
    unique('ledger_entries_wallet_idempotency_key').on(
      table.walletId,
      table.idempotencyKey,
    ),
    unique('ledger_entries_source_once_key').on(
      table.walletId,
      table.sourceType,
      table.sourceId,
      table.entryType,
    ),
    index('ledger_entries_wallet_effective_idx').on(
      table.walletId,
      table.effectiveAt,
      table.id,
    ),
    check('ledger_entries_amount_positive_check', sql`${table.amount} > 0`),
    check(
      'ledger_entries_reversal_not_self_check',
      sql`${table.reversalOfEntryId} IS NULL OR ${table.reversalOfEntryId} <> ${table.id}`,
    ),
  ],
);

export const adjustmentRequests = pgTable(
  'adjustment_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: varchar('public_id', { length: 48 })
      .notNull()
      .unique('adjustment_requests_public_id_key'),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    makerId: uuid('maker_id').notNull(),
    checkerId: uuid('checker_id'),
    direction: ledgerDirection('direction').notNull(),
    amount: numeric('amount', { precision: 24, scale: 8 }).notNull(),
    reason: text('reason').notNull(),
    status: adjustmentStatus('status').notNull().default('PENDING'),
    idempotencyKey: varchar('idempotency_key', { length: 128 })
      .notNull()
      .unique('adjustment_requests_idempotency_key_key'),
    executedEntryId: uuid('executed_entry_id').unique(
      'adjustment_requests_executed_entry_id_key',
    ),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('adjustment_requests_market_status_idx').on(
      table.marketId,
      table.status,
      table.createdAt,
    ),
    check(
      'adjustment_requests_amount_positive_check',
      sql`${table.amount} > 0`,
    ),
    check(
      'adjustment_requests_maker_checker_check',
      sql`${table.checkerId} IS NULL OR ${table.makerId} <> ${table.checkerId}`,
    ),
  ],
);

export const adjustmentActions = pgTable(
  'adjustment_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: varchar('public_id', { length: 48 })
      .notNull()
      .unique('adjustment_actions_public_id_key'),
    requestId: uuid('request_id')
      .notNull()
      .references(() => adjustmentRequests.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    actorId: uuid('actor_id').notNull(),
    action: adjustmentActionType('action').notNull(),
    reason: text('reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('adjustment_actions_request_action_key').on(
      table.requestId,
      table.action,
    ),
    index('adjustment_actions_request_created_idx').on(
      table.requestId,
      table.createdAt,
    ),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: varchar('public_id', { length: 48 })
      .notNull()
      .unique('audit_events_public_id_key'),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    actorId: uuid('actor_id').notNull(),
    action: varchar('action', { length: 96 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    requestId: varchar('request_id', { length: 96 }).notNull(),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_market_actor_time_idx').on(
      table.marketId,
      table.actorId,
      table.occurredAt,
    ),
    index('audit_events_entity_time_idx').on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
  ],
);

export const versionedRules = pgTable(
  'versioned_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: varchar('public_id', { length: 48 })
      .notNull()
      .unique('versioned_rules_public_id_key'),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    ruleType: varchar('rule_type', { length: 64 }).notNull(),
    scopeKey: varchar('scope_key', { length: 128 }).notNull(),
    version: integer('version').notNull(),
    status: ruleStatus('status').notNull().default('DRAFT'),
    effectiveFrom: utcTimestamp('effective_from').notNull(),
    effectiveTo: utcTimestamp('effective_to'),
    payload: jsonb('payload').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('versioned_rules_scope_version_key').on(
      table.marketId,
      table.ruleType,
      table.scopeKey,
      table.version,
    ),
    index('versioned_rules_effective_idx').on(
      table.marketId,
      table.ruleType,
      table.scopeKey,
      table.status,
      table.effectiveFrom,
    ),
    check('versioned_rules_version_positive_check', sql`${table.version} > 0`),
    check(
      'versioned_rules_effective_range_check',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: varchar('public_id', { length: 48 })
      .notNull()
      .unique('idempotency_records_public_id_key'),
    scope: varchar('scope', { length: 64 }).notNull(),
    key: varchar('key', { length: 128 }).notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    status: idempotencyStatus('status').notNull().default('PROCESSING'),
    responseCode: integer('response_code'),
    responseBody: jsonb('response_body'),
    lockedUntil: utcTimestamp('locked_until'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    completedAt: utcTimestamp('completed_at'),
  },
  (table) => [
    uniqueIndex('idempotency_records_scope_key_key').on(table.scope, table.key),
    index('idempotency_records_status_lock_idx').on(
      table.status,
      table.lockedUntil,
    ),
  ],
);
