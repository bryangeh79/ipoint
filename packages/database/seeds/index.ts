import { createDatabase } from '../src/client.js';
import { seedAgentCommissionRates } from './agent-commission.js';
import { seedFoundation } from './foundation.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const { db, pool } = createDatabase(databaseUrl);
try {
  await seedFoundation(db);
  await seedAgentCommissionRates(db);
  console.log('Foundation and agent commission seeds are current.');
} finally {
  await pool.end();
}
