import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const utcTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 6 });

export const accountStatus = pgEnum('account_status', [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'LOCKED',
  'ARCHIVED',
]);
export const credentialType = pgEnum('credential_type', ['PASSWORD']);
export const otpPurpose = pgEnum('otp_purpose', [
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'STEP_UP',
]);
export const marketStatus = pgEnum('market_status', ['ACTIVE', 'INACTIVE']);
export const adminStatus = pgEnum('admin_status', [
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
]);
export const actorType = pgEnum('actor_type', [
  'ACCOUNT',
  'ADMIN_USER',
  'SYSTEM',
]);
export const eventResult = pgEnum('event_result', [
  'SUCCESS',
  'FAILURE',
  'DENIED',
]);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: text('public_id').notNull(),
    email: text('email').notNull(),
    accountCountry: text('account_country').notNull(),
    status: accountStatus('status').notNull().default('PENDING'),
    emailVerifiedAt: utcTimestamp('email_verified_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('accounts_public_id_unique').on(table.publicId),
    unique('accounts_email_unique').on(table.email),
    check(
      'accounts_email_normalized_check',
      sql`${table.email} = lower(${table.email})`,
    ),
    check(
      'accounts_country_code_check',
      sql`char_length(${table.accountCountry}) = 2`,
    ),
    index('accounts_status_idx').on(table.status),
  ],
);

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    type: credentialType('type').notNull().default('PASSWORD'),
    secretHash: text('secret_hash').notNull(),
    hashAlgorithm: text('hash_algorithm').notNull(),
    hashVersion: integer('hash_version').notNull().default(1),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    revokedAt: utcTimestamp('revoked_at'),
  },
  (table) => [
    unique('credentials_account_type_unique').on(table.accountId, table.type),
    check(
      'credentials_hash_only_check',
      sql`char_length(${table.secretHash}) >= 32`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    familyId: uuid('family_id').notNull(),
    accessTokenHash: text('access_token_hash').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    lastSeenAt: utcTimestamp('last_seen_at').notNull().defaultNow(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    revokedAt: utcTimestamp('revoked_at'),
    revokeReason: text('revoke_reason'),
    replacedBySessionId: uuid('replaced_by_session_id'),
  },
  (table) => [
    unique('sessions_access_token_hash_unique').on(table.accessTokenHash),
    unique('sessions_refresh_token_hash_unique').on(table.refreshTokenHash),
    index('sessions_account_active_idx').on(table.accountId, table.expiresAt),
    check(
      'sessions_token_hashes_only_check',
      sql`
      char_length(${table.accessTokenHash}) = 64
      and char_length(${table.refreshTokenHash}) = 64
    `,
    ),
    check(
      'sessions_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const otps = pgTable(
  'otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    destination: text('destination').notNull(),
    purpose: otpPurpose('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    verifiedAt: utcTimestamp('verified_at'),
    consumedAt: utcTimestamp('consumed_at'),
  },
  (table) => [
    index('otps_destination_purpose_idx').on(table.destination, table.purpose),
    check(
      'otps_code_hash_only_check',
      sql`char_length(${table.codeHash}) = 64`,
    ),
    check(
      'otps_attempts_check',
      sql`${table.attempts} >= 0 and ${table.attempts} <= ${table.maxAttempts}`,
    ),
    check('otps_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    eventType: text('event_type').notNull(),
    result: eventResult('result').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('security_events_account_time_idx').on(
      table.accountId,
      table.occurredAt,
    ),
  ],
);

export const markets = pgTable(
  'markets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: marketStatus('status').notNull().default('INACTIVE'),
    currencyCode: text('currency_code').notNull(),
    timezone: text('timezone').notNull(),
    defaultLocale: text('default_locale').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [
    unique('markets_code_unique').on(table.code),
    check(
      'markets_code_check',
      sql`${table.code} = upper(${table.code}) and char_length(${table.code}) between 2 and 8`,
    ),
    check(
      'markets_currency_check',
      sql`${table.currencyCode} = upper(${table.currencyCode}) and char_length(${table.currencyCode}) = 3`,
    ),
  ],
);

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    status: adminStatus('status').notNull().default('ACTIVE'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [unique('admin_users_account_unique').on(table.accountId)],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    archivedAt: utcTimestamp('archived_at'),
  },
  (table) => [unique('roles_code_unique').on(table.code)],
);

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [unique('permissions_code_unique').on(table.code)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    assignedByAdminUserId: uuid('assigned_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    revokedAt: utcTimestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('role_assignments_active_unique')
      .on(table.adminUserId, table.roleId)
      .where(sql`${table.revokedAt} is null`),
    index('role_assignments_admin_idx').on(table.adminUserId),
  ],
);

export const marketAccess = pgTable(
  'market_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict' }),
    grantedByAdminUserId: uuid('granted_by_admin_user_id').references(
      () => adminUsers.id,
      { onDelete: 'restrict' },
    ),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    revokedAt: utcTimestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('market_access_active_unique')
      .on(table.adminUserId, table.marketId)
      .where(sql`${table.revokedAt} is null`),
    index('market_access_admin_idx').on(table.adminUserId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    result: eventResult('result').notNull(),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_actor_time_idx').on(
      table.actorType,
      table.actorId,
      table.occurredAt,
    ),
    index('audit_logs_entity_time_idx').on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index('audit_logs_market_time_idx').on(table.marketId, table.occurredAt),
  ],
);

export const entityTimelines = pgTable(
  'entity_timelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    eventType: text('event_type').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    marketId: uuid('market_id').references(() => markets.id, {
      onDelete: 'restrict',
    }),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('entity_timelines_entity_time_idx').on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
  ],
);

export const schema = {
  accounts,
  credentials,
  sessions,
  otps,
  securityEvents,
  markets,
  adminUsers,
  roles,
  permissions,
  rolePermissions,
  roleAssignments,
  marketAccess,
  auditLogs,
  entityTimelines,
};
