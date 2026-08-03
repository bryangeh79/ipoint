import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./src/__tests__/env-setup.ts', './src/__tests__/setup.ts'],
    // P7-S5C: the DB-heavy Nest integration suites (AppModule compile + migrate
    // + seed on a shared Postgres) legitimately exceed vitest's 10s default
    // hook budget when the full api directory runs in parallel. This only
    // extends the beforeAll/afterAll timeout; it does not relax any assertion
    // or skip any test. Empirically reproduced on the pre-S5C baseline too
    // (18 hook timeouts), so this is an environment/suite-load fix, not a
    // P7-S5C requirements change.
    hookTimeout: 60_000,
  },
});
