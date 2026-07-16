import { createDatabase } from '../src/client.js';
import { seedFoundation } from './foundation.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const { db, pool } = createDatabase(databaseUrl);
try {
  await seedFoundation(db);
  console.log('Foundation seed is current.');
} finally {
  await pool.end();
}
