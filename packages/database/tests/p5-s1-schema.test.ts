import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const hasDatabase = !!process.env.DATABASE_URL;
import {
  agentActivations,
  commissionAdjustmentRequests,
  commissionLedger,
  commissionProcessing,
  commissionProcessingResults,
  commissionRateVersions,
  commissionStatusEvents,
  idempotencyKeys,
  merchantAttributions,
  referralRelationships,
  schema,
} from '../schema/index.js';
import { createDatabase } from '../src/client.js';
import { migrationsDirectory } from '../src/paths.js';
import { myDefaultCommissionRates } from '../seeds/agent-commission.js';

const phase5Tables = [
  'agent_activation',
  'agent_activation_status_log',
  'referral_relationship',
  'commission_processing',
  'commission_rate_version',
  'commission_ledger',
  'commission_status_event',
  'idempotency_key',
  'merchant_attribution',
  'commission_processing_result',
  'commission_adjustment_request',
] as const;

const migrationPath = `${migrationsDirectory}/0018_phase_5_agent_commission_schema.sql`;

const schemaDescribe = hasDatabase ? describe : describe.skip;

schemaDescribe('P5-S1 Drizzle schema', () => {
  it('exports all 11 Phase 5 tables', () => {
    const tableNames = Object.values(schema).map(
      (table) => getTableConfig(table).name,
    );
    expect(tableNames).toEqual(expect.arrayContaining([...phase5Tables]));
  });

  it('declares frozen unique and check constraints', () => {
    const configs = [
      getTableConfig(agentActivations),
      getTableConfig(referralRelationships),
      getTableConfig(commissionProcessing),
      getTableConfig(commissionRateVersions),
      getTableConfig(commissionLedger),
      getTableConfig(commissionStatusEvents),
      getTableConfig(idempotencyKeys),
      getTableConfig(merchantAttributions),
      getTableConfig(commissionProcessingResults),
      getTableConfig(commissionAdjustmentRequests),
    ];
    const names = configs.flatMap((config) => [
      ...config.uniqueConstraints.map((constraint) => constraint.name),
      ...config.checks.map((constraint) => constraint.name),
      ...config.indexes.map((indexDefinition) => indexDefinition.config.name),
    ]);
    expect(names).toEqual(
      expect.arrayContaining([
        'uq_agent_member_market',
        'chk_no_self_referral',
        'uq_processing_key',
        'chk_rate_effective_range',
        'uq_ledger_entry_key',
        'chk_posting_status',
        'uq_status_event_sequence',
        'chk_status_to',
        'chk_idempotency_status',
        'uq_merchant_attribution_merchant',
        'uq_merchant_attribution_branch',
        'chk_skip_no_beneficiary',
        'chk_maker_checker_different',
        'chk_decided_fields',
      ]),
    );
  });

  it('contains the GiST exclusion, immutable triggers, and five MY defaults', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
    expect(migration).toMatch(/CONSTRAINT uq_rate_period EXCLUDE USING gist/u);
    expect(migration).toContain('commission_ledger_reject_update');
    expect(migration).toContain('referral_relationship_reject_update');
    expect(myDefaultCommissionRates).toHaveLength(5);
    for (const [type, generation, rate, rateType] of myDefaultCommissionRates) {
      // Seed values are decimal strings (e.g. '88.0000000000') but the
      // migration SQL renders them as numeric literals with trailing zeros
      // trimmed to significant decimals (e.g. 88.00).  Use a regex that
      // accepts the parsed number with optional decimal fraction.
      const numPattern = String(parseFloat(rate)).replaceAll('.', '\\.');
      expect(migration).toMatch(
        new RegExp(
          `\\('${type}', ${generation}, 'MY', ${numPattern}(?:\\.\\d+)?, '${rateType}'`,
        ),
      );
    }
  });
});

const databaseUrl = process.env['DATABASE_URL'];

describe
  .skipIf(!databaseUrl)
  .sequential('P5-S1 PostgreSQL migration and constraints', () => {
    const databaseName = `ipoint_p5_s1_${randomUUID().replaceAll('-', '')}`;
    const adminUrl = new URL(databaseUrl ?? '');
    adminUrl.pathname = '/postgres';
    const disposableUrl = new URL(databaseUrl ?? '');
    disposableUrl.pathname = `/${databaseName}`;
    const admin = createDatabase(adminUrl.toString());
    const disposable = createDatabase(disposableUrl.toString());
    let phase5Migration = '';

    beforeAll(async () => {
      await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
      phase5Migration = await readFile(migrationPath, 'utf8');
      const baseMigrations = (await readdir(migrationsDirectory))
        .filter((file) => /^00(0\d|1[0-7])_[a-z0-9_]+\.sql$/u.test(file))
        .sort();
      for (const migration of baseMigrations) {
        await disposable.pool.query(
          await readFile(`${migrationsDirectory}/${migration}`, 'utf8'),
        );
      }
    });

    afterAll(async () => {
      await disposable.pool.end();
      await admin.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await admin.pool.end();
    });

    it('applies and transactionally reverts without leaving schema objects', async () => {
      const client = await disposable.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(phase5Migration);
        const during = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
          [phase5Tables],
        );
        expect(during.rowCount).toBe(11);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      const after = await disposable.pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'commission_ledger'`,
      );
      expect(after.rowCount).toBe(0);
    });

    it('applies cleanly and creates all 11 tables', async () => {
      await disposable.pool.query(phase5Migration);
      const tables = await disposable.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])
         ORDER BY table_name`,
        [phase5Tables],
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual(
        [...phase5Tables].sort(),
      );
    });

    it('loads the exact five frozen MY rate versions', async () => {
      const rates = await disposable.pool.query<{
        commission_type: string;
        generation: number;
        rate_value: string;
        rate_type: string;
      }>(
        `SELECT commission_type, generation, rate_value::text, rate_type
         FROM commission_rate_version WHERE market = 'MY'
         ORDER BY commission_type, generation`,
      );
      expect(rates.rows).toEqual([
        {
          commission_type: 'AGENT_UPGRADE',
          generation: 1,
          rate_value: '88.0000000000',
          rate_type: 'FIXED',
        },
        {
          commission_type: 'AGENT_UPGRADE',
          generation: 2,
          rate_value: '38.0000000000',
          rate_type: 'FIXED',
        },
        {
          commission_type: 'MEMBER_CONSUMPTION',
          generation: 1,
          rate_value: '0.0100000000',
          rate_type: 'PERCENTAGE',
        },
        {
          commission_type: 'MEMBER_CONSUMPTION',
          generation: 2,
          rate_value: '0.0050000000',
          rate_type: 'PERCENTAGE',
        },
        {
          commission_type: 'MERCHANT_RECRUITMENT',
          generation: 1,
          rate_value: '0.0050000000',
          rate_type: 'PERCENTAGE',
        },
      ]);
    });

    it('enforces unique, check, foreign-key, and overlap invariants', async () => {
      const account1 = randomUUID();
      const account2 = randomUUID();
      const member1 = randomUUID();
      const member2 = randomUUID();
      await disposable.pool.query(
        `INSERT INTO accounts (id, public_id, email, account_country) VALUES
         ($1, $2, $3, 'MY'), ($4, $5, $6, 'MY')`,
        [
          account1,
          `acct_${account1}`,
          `${account1}@example.com`,
          account2,
          `acct_${account2}`,
          `${account2}@example.com`,
        ],
      );
      await disposable.pool.query(
        `INSERT INTO members (id, account_id, public_member_id, referral_code) VALUES
         ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [
          member1,
          account1,
          `mem_${member1}`,
          `ref_${member1}`,
          member2,
          account2,
          `mem_${member2}`,
          `ref_${member2}`,
        ],
      );
      await disposable.pool.query(
        `INSERT INTO agent_activation (member_id, market) VALUES ($1, 'MY')`,
        [member1],
      );
      await expect(
        disposable.pool.query(
          `INSERT INTO agent_activation (member_id, market) VALUES ($1, 'MY')`,
          [member1],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        disposable.pool.query(
          `INSERT INTO agent_activation (member_id, market) VALUES ($1, 'MY')`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        disposable.pool.query(
          `INSERT INTO referral_relationship (referee_id, referrer_id) VALUES ($1, $1)`,
          [member1],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        disposable.pool.query(
          `INSERT INTO commission_ledger (
             public_reference, beneficiary_id, source_type, source_reference,
             market, currency, amount, entry_type, posting_status,
             canonical_entry_key, effective_time
           ) VALUES ('COM-test', $1, 'TEST', 'source', 'MY', 'MYR', 1,
             'ADMIN_ADJUSTMENT', 'PENDING', 'entry-test', now())`,
          [member1],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        disposable.pool.query(
          `INSERT INTO commission_rate_version (
             commission_type, generation, market, rate_value, rate_type,
             effective_from, created_by
           ) VALUES ('AGENT_UPGRADE', 1, 'MY', 99, 'FIXED',
             '2026-08-01T00:00:00Z', $1)`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23P01' });
    });
  });
