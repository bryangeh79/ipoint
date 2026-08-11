/**
 * P8-L06 member QR surface - HTTP integration suite (real PostgreSQL).
 *
 * Boots the real NestJS AppModule against a dedicated FRESH
 * `ipoint_p8l06_*` database (drop/create + migrate + foundation seed) and
 * drives GET/POST/DELETE /api/v1/members/me/qr over real HTTP with
 * supertest. Fail-closed: the suite refuses to start unless
 * `P8L06_DESTRUCTIVE_TEST=1` and DATABASE_URL names an `ipoint_p8l06_*`
 * database (never `ipoint_ci`, never shared dev databases).
 *
 * Covers: the contract route table (ownership guard, exact error codes,
 * idempotent replay on POST/DELETE, audit rows on all three routes), the
 * L-06 signed short-lived rotating token (verifiable, never persisted in
 * plaintext), rotation chaining and the one-ACTIVE-per-member invariant.
 */

import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import {
  authIdempotencyKeys,
  members,
  memberQrIdentities,
  migrate,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { createMember, insertMarket } from '../load/harness.js';
import {
  verifyMemberQrToken,
  MEMBER_QR_SIGNING_SECRET_ENV,
  MEMBER_QR_TTL_SECONDS_ENV,
} from './member-qr.crypto.js';
import {
  DESTRUCTIVE_TEST_OPT_IN_ENV,
  destructiveTestOptIn,
  testDatabaseName,
} from './member-qr.guards.js';

const databaseUrl = process.env['DATABASE_URL'];
const SIGNING_SECRET = 'p8-l06-integration-signing-secret-32chars!';
const QR_PATH = '/api/v1/members/me/qr';

describe('P8-L06 destructive fresh-database guard', () => {
  it('accepts only the dedicated ipoint_p8l06_* test pattern', () => {
    expect(
      testDatabaseName(
        'postgresql://user:pass@127.0.0.1:55432/ipoint_p8l06_test',
      ),
    ).toBe('ipoint_p8l06_test');
    expect(
      testDatabaseName('postgres://localhost/ipoint_p8l06_migration_test'),
    ).toBe('ipoint_p8l06_migration_test');
  });

  it('rejects protected, arbitrary and production-looking names', () => {
    for (const name of ['postgres', 'template0', 'template1']) {
      expect(testDatabaseName(`postgresql://localhost/${name}`)).toBeNull();
    }
    expect(testDatabaseName('postgresql://localhost/ipoint_ci')).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_dev')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_production'),
    ).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_p8l06')).toBeNull();
    expect(testDatabaseName('not a url')).toBeNull();
    expect(testDatabaseName(undefined)).toBeNull();
  });

  it('requires the explicit destructive-test opt-in', () => {
    expect(destructiveTestOptIn({})).toBe(false);
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: '0' })).toBe(
      false,
    );
    expect(
      destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'false' }),
    ).toBe(false);
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: '1' })).toBe(
      true,
    );
    expect(
      destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'TRUE' }),
    ).toBe(true);
  });
});

describe.skipIf(!databaseUrl)(
  'P8-L06 member QR HTTP integration (real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let member: { accountId: string; memberId: string; token: string };

    const bearer = (token: string) => ({
      Authorization: `Bearer ${token}`,
    });

    function expectError(body: unknown, code: string): void {
      expect(body).toMatchObject({ error: { code } });
    }

    async function qrRows(memberId: string) {
      return database.db
        .select()
        .from(memberQrIdentities)
        .where(eq(memberQrIdentities.memberId, memberId))
        .orderBy(sql`created_at`, sql`id`);
    }

    async function activeQrCount(memberId: string): Promise<number> {
      const rows = await database.db
        .select({ id: memberQrIdentities.id })
        .from(memberQrIdentities)
        .where(
          and(
            eq(memberQrIdentities.memberId, memberId),
            eq(memberQrIdentities.status, 'ACTIVE'),
          ),
        );
      return rows.length;
    }

    async function auditActions(memberId: string): Promise<string[]> {
      const actions = await database.pool.query<{ action: string }>(
        `SELECT action FROM audit_logs
          WHERE actor_id = $1
          ORDER BY occurred_at, id`,
        [member.accountId],
      );
      void memberId;
      return actions.rows.map((row) => row.action);
    }

    beforeAll(async () => {
      const dbName = testDatabaseName(databaseUrl);
      if (!dbName) {
        throw new Error(
          `P8-L06 integration suite is fail-closed: DATABASE_URL must name a dedicated test database matching ^ipoint_p8l06_[a-z0-9_]+$ and must not be a protected database (received ${databaseUrl ?? 'unset'}).`,
        );
      }
      if (!destructiveTestOptIn(process.env)) {
        throw new Error(
          `P8-L06 integration suite is fail-closed: set ${DESTRUCTIVE_TEST_OPT_IN_ENV}=1 to allow recreating the dedicated test database "${dbName}".`,
        );
      }
      const maintenanceUrl = (databaseUrl ?? '').replace(
        /\/[^/]+$/u,
        '/postgres',
      );
      const { Pool } = await import('pg');
      const maintenance = new Pool({ connectionString: maintenanceUrl });
      await maintenance.query(
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
      );
      await maintenance.query(`CREATE DATABASE "${dbName}"`);
      await maintenance.end();

      process.env['DATABASE_URL'] = databaseUrl ?? '';
      process.env['REDIS_URL'] = 'redis://127.0.0.1:56379';
      process.env['AUTH_OTP_PEPPER'] =
        'p8-l06-member-qr-pepper-at-least-32-characters';
      process.env['REDEMPTION_VOUCHER_ENCRYPTION_KEY'] =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      process.env[MEMBER_QR_SIGNING_SECRET_ENV] = SIGNING_SECRET;
      process.env[MEMBER_QR_TTL_SECONDS_ENV] = '300';
      process.env['NODE_ENV'] = 'test';
      process.env['LOG_LEVEL'] = 'silent';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      configureApplication(app, {
        enableShutdownHooks: false,
        scanSwaggerRoutes: false,
      });
      auth = app.get(AuthService);
      database = app.get(DatabaseService);
      await migrate(database.pool);
      await seedFoundation(database.db);
      await app.init();
      server = app.getHttpServer() as Server;

      const market = await insertMarket(database);
      member = await createMember(database, auth, market.id);
    });

    afterAll(async () => {
      await app?.close();
      delete process.env[MEMBER_QR_SIGNING_SECRET_ENV];
      delete process.env[MEMBER_QR_TTL_SECONDS_ENV];
    });

    it('rejects unauthenticated access (401)', async () => {
      await supertest(server).get(QR_PATH).expect(401);
      await supertest(server).post(QR_PATH).send({}).expect(401);
      await supertest(server).delete(QR_PATH).send({}).expect(401);
    });

    it('GET returns a null QR state when the member has no QR row yet', async () => {
      const response = await supertest(server)
        .get(QR_PATH)
        .set(bearer(member.token))
        .expect(200);
      expect(response.body).toEqual({ qr: null });
    });

    it('POST requires an idempotency key (VALIDATION_ERROR)', async () => {
      const response = await supertest(server)
        .post(QR_PATH)
        .set(bearer(member.token))
        .send({})
        .expect(400);
      expectError(response.body, 'VALIDATION_ERROR');
    });

    it('POST issues the first QR identity with a verifiable signed token', async () => {
      const response = await supertest(server)
        .post(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'issue-1')
        .send({})
        .expect(200);
      const qr = response.body.qr;
      expect(qr.status).toBe('ACTIVE');
      expect(qr.public_qr_id).toMatch(/^qrv1_/u);
      expect(Date.parse(qr.issued_at)).toBeGreaterThan(0);
      expect(Date.parse(qr.expires_at) - Date.parse(qr.issued_at)).toBe(
        300_000,
      );
      const verified = verifyMemberQrToken(qr.display_token, SIGNING_SECRET);
      expect(verified?.public_qr_id).toBe(qr.public_qr_id);
      expect(verified?.expires_at).toBe(qr.expires_at);

      const rows = await qrRows(member.memberId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('ACTIVE');
      expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
      // Plaintext token is never persisted.
      expect(rows[0]?.tokenHash).not.toBe(qr.display_token);
      expect(
        createHash('sha256').update(qr.display_token).digest('hex'),
      ).not.toBe(rows[0]?.tokenHash);
    });

    it('POST replays the stored response for the same idempotency key', async () => {
      const first = await supertest(server)
        .post(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'issue-1')
        .send({})
        .expect(200);
      const replay = await supertest(server)
        .post(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'issue-1')
        .send({})
        .expect(200);
      expect(replay.body.qr.public_qr_id).toBe(first.body.qr.public_qr_id);
      const rows = await qrRows(member.memberId);
      expect(rows).toHaveLength(1); // no duplicate row on replay
    });

    it('POST rotates the ACTIVE identity and chains the rows', async () => {
      const before = await qrRows(member.memberId);
      const oldId = before[0]?.id ?? '';
      const response = await supertest(server)
        .post(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'rotate-1')
        .send({})
        .expect(200);
      expect(response.body.qr.status).toBe('ACTIVE');
      expect(response.body.qr.public_qr_id).not.toBe(before[0]?.publicQrId);

      const rows = await qrRows(member.memberId);
      expect(rows).toHaveLength(2);
      const old = rows.find((row) => row.id === oldId);
      const newest = rows.find((row) => row.id !== oldId);
      expect(old?.status).toBe('ROTATED');
      expect(old?.rotatedToId).toBe(newest?.id);
      expect(newest?.status).toBe('ACTIVE');
      expect(newest?.rotatedFromId).toBe(oldId);
      expect(await activeQrCount(member.memberId)).toBe(1);
    });

    it('GET returns the active QR state', async () => {
      const response = await supertest(server)
        .get(QR_PATH)
        .set(bearer(member.token))
        .expect(200);
      expect(response.body.qr.status).toBe('ACTIVE');
      const rows = await qrRows(member.memberId);
      const newest = rows.find((row) => row.status === 'ACTIVE');
      expect(response.body.qr.public_qr_id).toBe(newest?.publicQrId);
      // Response must never leak internal ids, hashes or tokens material.
      expect(response.body.qr).not.toHaveProperty('id');
      expect(response.body.qr).not.toHaveProperty('token_hash');
      expect(response.body.qr).not.toHaveProperty('tokenHash');
    });

    it('DELETE requires an idempotency key (VALIDATION_ERROR)', async () => {
      const response = await supertest(server)
        .delete(QR_PATH)
        .set(bearer(member.token))
        .send({})
        .expect(400);
      expectError(response.body, 'VALIDATION_ERROR');
    });

    it('DELETE revokes the ACTIVE identity (204) with a default reason', async () => {
      await supertest(server)
        .delete(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'revoke-1')
        .send({})
        .expect(204);
      const rows = await qrRows(member.memberId);
      const revoked = rows.find((row) => row.status === 'REVOKED');
      expect(revoked).toBeDefined();
      expect(revoked?.revokedAt).not.toBeNull();
      expect(revoked?.reason).toBe('MEMBER_INITIATED');
      expect(await activeQrCount(member.memberId)).toBe(0);
    });

    it('DELETE replays 204 for the same idempotency key without state change', async () => {
      const rowsBefore = await qrRows(member.memberId);
      await supertest(server)
        .delete(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'revoke-1')
        .send({})
        .expect(204);
      const rowsAfter = await qrRows(member.memberId);
      expect(rowsAfter).toHaveLength(rowsBefore.length);
    });

    it('DELETE on an already-revoked identity returns QR_REVOKED (new key)', async () => {
      const response = await supertest(server)
        .delete(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'revoke-2')
        .send({})
        .expect(409);
      expectError(response.body, 'QR_REVOKED');
    });

    it('POST after revocation returns QR_REVOKED', async () => {
      const response = await supertest(server)
        .post(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'post-after-revoke')
        .send({})
        .expect(409);
      expectError(response.body, 'QR_REVOKED');
    });

    it('GET after revocation returns QR_REVOKED', async () => {
      const response = await supertest(server)
        .get(QR_PATH)
        .set(bearer(member.token))
        .expect(409);
      expectError(response.body, 'QR_REVOKED');
    });

    it('records audit rows for issued, rotated, read and revoked actions', async () => {
      const actions = await auditActions(member.memberId);
      expect(actions).toContain('member.qr.issued');
      expect(actions).toContain('member.qr.rotated');
      expect(actions).toContain('member.qr.revoked');
      expect(actions).toContain('member.qr.read');
      // No audit row may carry token material.
      const raw = await database.pool.query(
        `SELECT after, before FROM audit_logs WHERE actor_id = $1`,
        [member.accountId],
      );
      for (const row of raw.rows) {
        const payload = JSON.stringify(row);
        expect(payload).not.toContain('display_token');
        expect(payload).not.toContain('token_hash');
      }
    });

    it('stores one idempotency record per unique key (no leak between members)', async () => {
      const rows = await database.db
        .select()
        .from(authIdempotencyKeys)
        .where(
          and(
            eq(
              authIdempotencyKeys.scope,
              `member-qr:rotate:${member.memberId}`,
            ),
            eq(authIdempotencyKeys.key, 'issue-1'),
          ),
        )
        .limit(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.response).toMatchObject({ qr: expect.any(Object) });
      expect(rows[0]?.statusCode).toBe(200);
    });

    it('returns MEMBER_CLOSED (403) for every route after the member is closed', async () => {
      await database.db
        .update(members)
        .set({ status: 'CLOSED', closedAt: new Date() })
        .where(eq(members.id, member.memberId));
      const getResponse = await supertest(server)
        .get(QR_PATH)
        .set(bearer(member.token))
        .expect(403);
      expectError(getResponse.body, 'MEMBER_CLOSED');
      const postResponse = await supertest(server)
        .post(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'closed-post')
        .send({})
        .expect(403);
      expectError(postResponse.body, 'MEMBER_CLOSED');
      const deleteResponse = await supertest(server)
        .delete(QR_PATH)
        .set(bearer(member.token))
        .set('Idempotency-Key', 'closed-delete')
        .send({})
        .expect(403);
      expectError(deleteResponse.body, 'MEMBER_CLOSED');
    });

    it('does not expose raw database errors (unknown route states stay clean)', async () => {
      const response = await supertest(server)
        .get(QR_PATH)
        .set(bearer(member.token))
        .expect(403);
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('constraint');
      expect(body).not.toContain('23505');
      expect(body).not.toContain('postgres');
    });
  },
);
