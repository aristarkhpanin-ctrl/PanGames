import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Правила проекта «Гавань». Часть из них — не стиль, а защита инвариантов из CLAUDE.md:
 * ядро симуляции обязано быть чистым и детерминированным, иначе клиент и сервер разойдутся
 * в расчётах, и обнаружится это только на живом сервере.
 */

/** Что запрещено в packages/shared: источники недетерминизма. */
const impureProperties = [
  {
    object: 'Math',
    property: 'random',
    message:
      'packages/shared должен быть детерминированным. Используй seeded PRNG, сид приходит аргументом.',
  },
  {
    object: 'Date',
    property: 'now',
    message: 'packages/shared не знает текущего времени. Время приходит аргументом.',
  },
  {
    object: 'performance',
    property: 'now',
    message: 'packages/shared не знает текущего времени. Время приходит аргументом.',
  },
];

/** Что запрещено в packages/shared: платформенные глобальные объекты. */
const impureGlobals = [
  {
    name: 'Date',
    message: 'packages/shared не знает текущего времени. Время приходит аргументом.',
  },
  { name: 'performance', message: 'packages/shared не знает текущего времени.' },
  { name: 'crypto', message: 'packages/shared должен быть детерминированным.' },
  { name: 'fetch', message: 'packages/shared не ходит в сеть.' },
  { name: 'window', message: 'packages/shared не знает про DOM.' },
  { name: 'document', message: 'packages/shared не знает про DOM.' },
  { name: 'process', message: 'packages/shared не знает про Node.' },
];

/** Что запрещено импортировать в packages/shared. */
const impureImportPatterns = [
  { group: ['three', 'three/*'], message: 'packages/shared не знает про three.js.' },
  { group: ['node:*'], message: 'packages/shared не знает про Node API.' },
  {
    group: ['fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'child_process'],
    message: 'packages/shared не знает про Node API.',
  },
  { group: ['react', 'react-dom', 'zustand'], message: 'packages/shared не знает про клиент.' },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/drizzle/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      // any запрещён уставом проекта, не вкусовщиной.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Циклические импорты ломают порядок инициализации и мешают вынести sim в воркер.
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      'import-x/no-self-import': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  // Ядро симуляции: чистые детерминированные функции.
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...impureProperties],
      'no-restricted-globals': ['error', ...impureGlobals],
      'no-restricted-imports': ['error', { patterns: impureImportPatterns }],
    },
  },

  // Тестам в shared можно знать про время: они его подставляют, а не читают.
  {
    files: ['packages/shared/**/*.test.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    files: ['apps/server/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Конфиги и скрипты сборки живут вне системы типов проекта.
  {
    files: ['*.js', '*.config.{js,ts}', '**/*.config.{js,ts}', '**/scripts/**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  prettier,
);
