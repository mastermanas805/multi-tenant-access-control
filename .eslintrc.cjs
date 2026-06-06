/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.base.json', './packages/*/tsconfig.json', './apps/*/tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/strict-type-checked',
    'plugin:@typescript-eslint/stylistic-type-checked',
    'prettier',
  ],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: [
    '.eslintrc.cjs',
    'jest.config.*',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/node_modules/**',
  ],
  rules: {
    '@typescript-eslint/explicit-function-return-type': [
      'error',
      { allowExpressions: true, allowTypedFunctionExpressions: true },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    '@typescript-eslint/no-extraneous-class': 'off',
    // Defensive runtime null/undefined checks in domain equality/guard methods
    // protect against untyped (JSON/JS) callers at the boundary; keep them.
    '@typescript-eslint/no-unnecessary-condition': 'off',
    // Comparing a typed enum value against a literal status string is intentional
    // in the HTTP-status mapper; the values are validated by the runtime.
    '@typescript-eslint/no-unsafe-enum-comparison': 'off',
  },
  overrides: [
    {
      // The domain layer must never import framework code. Enforce the dependency rule.
      files: ['packages/kernel/src/**/*.ts', 'apps/*/src/modules/**/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: '@nestjs/common', message: 'Domain/kernel must not depend on NestJS.' },
              { name: '@nestjs/core', message: 'Domain/kernel must not depend on NestJS.' },
              { name: 'typeorm', message: 'Domain/kernel must not depend on TypeORM.' },
            ],
            patterns: ['@nestjs/*', 'typeorm/*'],
          },
        ],
      },
    },
    {
      files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/unbound-method': 'off',
      },
    },
  ],
};
