import { describe, it, expect } from 'vitest';

/**
 * Wallet HTTP integration tests.
 *
 * These tests require a running PostgreSQL database with migrations applied.
 * They are skipped by default; uncomment the test body and ensure
 * TEST_DATABASE_URL is set in your environment.
 *
 * Prerequisites:
 * - TEST_DATABASE_URL environment variable pointing to a test database
 * - Database migrations have been applied
 * - An OAuth token for a valid member account
 */
describe('Wallet HTTP Integration', () => {
  it.skip('GET /wallets returns wallets for authenticated member', async () => {
    // const token = await getAuthToken();
    // const response = await request(app)
    //   .get('/wallets')
    //   .set('Authorization', `Bearer ${token}`);
    // expect(response.status).toBe(200);
    // expect(Array.isArray(response.body)).toBe(true);
    expect(true).toBe(true); // Placeholder - integration tests require test DB
  });

  it.skip('GET /wallets/:id returns wallet details', async () => {
    expect(true).toBe(true); // Placeholder
  });

  it.skip('GET /wallets/:id/entries returns paginated entries', async () => {
    expect(true).toBe(true); // Placeholder
  });

  it.skip('POST /wallets creates ledger entry (idempotent)', async () => {
    expect(true).toBe(true); // Placeholder
  });
});
