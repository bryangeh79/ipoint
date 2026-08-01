import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'admin-shell.spec.ts',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'node "C:/AI_WORKSPACE/iPoint App/node_modules/vite/bin/vite.js" apps/admin-web --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175/admin/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
