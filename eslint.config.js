import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['.auth/**', '.state/**', 'logs/**', 'node_modules/**'],
  },
  prettier,
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { '@stylistic': stylistic },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: ['const', 'let'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
      ],
    },
  },
);
