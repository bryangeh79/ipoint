import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
