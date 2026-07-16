import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './schema/index.ts',
  out: './migrations/generated',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://localhost/ipoint',
  },
  strict: true,
  verbose: true,
});
