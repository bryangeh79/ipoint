import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.{spec,test}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/e2e/**',
      '**/*.integration.*',
      '**/*.performance.*',
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
