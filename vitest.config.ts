import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./apps/member-web/src/test/setup.ts'],
    include: ['**/*.{spec,test}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/e2e/**',
      '**/.git/**',
      '**/.acceptance-evidence/**',
      '**/.acceptance/**',
      '**/.local/**',
      '**/Concept/**',
      '**/memory/**',
      '**/tasks/**',
    ],
  },
});
