import { defineConfig } from '@playwright/test';

const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://ipoint_test:ipoint_test@127.0.0.1:55440/ipoint_database_test';
const e2eRedisUrl = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:56379';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry' },
  webServer: [
    {
      command: 'pnpm --filter @ipoint/api exec tsx src/main.ts',
      url: 'http://127.0.0.1:3100/health/live',
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3100',
        LOG_LEVEL: 'silent',
        DATABASE_URL: e2eDatabaseUrl,
        REDIS_URL: e2eRedisUrl,
        AUTH_OTP_PEPPER: 'playwright-otp-pepper-at-least-32-characters',
        AUTH_ACCESS_TTL_SECONDS: '900',
        AUTH_REFRESH_TTL_SECONDS: '2592000',
        AUTH_OTP_TTL_SECONDS: '600',
        AUTH_OTP_MAX_ATTEMPTS: '5',
        REDEMPTION_VOUCHER_ENCRYPTION_KEY:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        APP_VERSION: 'phase-1-e2e',
      },
    },
    {
      command:
        'pnpm --filter @ipoint/member-web build && pnpm --filter @ipoint/member-web preview --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:3100/api/v1' },
    },
    {
      command:
        'pnpm --filter @ipoint/merchant-web build && pnpm --filter @ipoint/merchant-web preview --host 127.0.0.1 --port 4174',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:3100/api/v1' },
    },
    {
      command:
        'pnpm --filter @ipoint/admin-web build && pnpm --filter @ipoint/admin-web preview --host 127.0.0.1 --port 4175',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:3100/api/v1' },
    },
  ],
});
