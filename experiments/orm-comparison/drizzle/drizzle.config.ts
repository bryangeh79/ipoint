import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url:
      process.env.DRIZZLE_POC_DATABASE_URL ??
      'postgresql://ipoint_poc:ipoint_poc@localhost:55432/ipoint_drizzle_poc',
  },
  strict: true,
  verbose: true,
});
