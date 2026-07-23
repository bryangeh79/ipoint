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
            'apps/member-web/**',
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
    ],
  },
});
