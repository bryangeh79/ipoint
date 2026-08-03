import { defineConfig } from '@playwright/test';

/**
 * P7-S4B Admin dashboard browser verification (sandbox-friendly).
 *
 * Runs against a local Vite server with the API fully mocked in the spec, so
 * no live API or database is required. Desktop + 320px mobile dashboard
 * flows plus axe coverage (zero serious/critical violations).
 */
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.e2e.spec.ts',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'on-first-retry',
    // The sandbox image ships the full chromium build; the headless shell is
    // not always present, so run the full binary in new-headless mode.
    channel: 'chromium',
  },
  webServer: {
    command:
      'node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175/admin/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
