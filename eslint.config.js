import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/', '**/node_modules/', 'apps/api/drizzle/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Variável ignorada de propósito começa com "_" (ex.: desestruturação para remover um campo).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Operador vírgula `(a(), b())` esconde efeitos colaterais: use instruções separadas.
      'no-sequences': ['error', { allowInParentheses: false }],
      'no-console': 'error',
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Scripts de linha de comando escrevem no terminal.
    files: ['apps/api/src/db/migrate.ts'],
    rules: { 'no-console': 'off' },
  },
);
