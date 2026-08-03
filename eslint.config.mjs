import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typedRules = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['**/*.{ts,tsx}'],
}));

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '.git/**',
      '.cache/**',
      '.acceptance-evidence/**',
      '.acceptance/**',
      '.local/**',
      '.openclaw/**',
      'Concept/**',
      'memory/**',
      'tasks/**',
      'apps/member-web/src/**',
      'apps/merchant-web/src/**',
      'apps/admin-web/src/**',
      'apps/admin-web/vitest.config.ts',
      'scripts/**',
      '**/playwright*.config.ts',
      'fix-symlinks.js',
      'git-commit-push.js',
      'git-audit.js',
      'git-execute.js',
      'git-helper.js',
      'p6-audit.js',
      'p6-audit-fast.js',
      'fast-lint.mjs',
      'jiti/**',
      'run-*.sh',
      'fix-*.js',
    ],
  },
  eslint.configs.recommended,
  ...typedRules,
  prettier,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: false },
      ],
    },
  },
  {
    files: ['**/transaction-read.service.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: [
      'apps/api/src/transaction/transaction-commission-dispatch.writer.ts',
      'apps/api/src/transaction/transaction-commission-outbox.worker.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: [
      'apps/api/src/domain/commission/adjustment.service.ts',
      'apps/api/src/domain/commission/agent-upgrade.service.ts',
      'apps/api/src/domain/commission/compensation.service.ts',
      'apps/api/src/domain/commission/member-consumption.service.ts',
      'apps/api/src/domain/commission/merchant-recruitment.service.ts',
      'apps/api/src/domain/commission/rate.service.ts',
      'apps/api/src/domain/commission/query.service.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: [
      'apps/api/src/domain/referral/**/*.ts',
      'apps/api/src/domain/agent-activation/service.ts',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    files: ['scripts/**/*.{js,cjs,mjs}'],
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
    },
  },
  {
    files: ['apps/admin-web/public/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
);
