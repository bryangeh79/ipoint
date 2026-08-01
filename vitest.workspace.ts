import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node-unit',
          include: ['**/*.{spec,test}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/tests/e2e/**',
            '**/*.integration.*',
            '**/*.performance.*',
            'packages/database/tests/p5-s1-schema.test.ts',
            'apps/api/src/__tests__/app.e2e.spec.ts',
            'apps/member-web/**',
            'apps/admin-web/**',
            '**/.git/**',
            '**/.acceptance-evidence/**',
            '**/.acceptance/**',
            '**/.local/**',
            '**/Concept/**',
            '**/memory/**',
            '**/tasks/**',
          ],
        },
      },
      './apps/member-web/vitest.config.ts',
      './apps/admin-web/vitest.config.ts',
    ],
  },
});
