// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * What server/src/core must never import (CLAUDE.md, "Architecture rules"). The
 * core holds domain, use cases and ports; frameworks, the database and adapters
 * depend on it, never the other way round.
 */
const coreForbiddenImports = [
  { what: 'Prisma', regex: '^(prisma|prisma/.+|@prisma/.+|\\.prisma/.+)$' },
  { what: 'pg', regex: '^pg([-/].+)?$' },
  { what: 'Fastify', regex: '^(fastify|fastify/.+|fastify-.+|@fastify/.+)$' },
  { what: 'tRPC', regex: '^@trpc/.+$' },
  { what: 'an adapter', regex: '(^|/)adapters(/|$)' },
  { what: 'the server package entry, which re-exports adapters', regex: '^@aeolus-fleet/server(/.+)?$' },
];

const coreBoundaryMessage = (/** @type {string} */ what) =>
  `server/src/core must not import ${what}. The core holds domain, use cases and ports; adapters depend on it, never the other way round.`;

// esquery regex literals cannot contain a slash, so write it as \x2F.
const esqueryRegex = (/** @type {string} */ regex) => `/${regex.replaceAll('/', '\\x2F')}/`;

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/coverage/',
    '**/next-env.d.ts',
    'packages/server/src/adapters/prisma/generated/',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    name: 'aeolus/web',
    files: ['packages/web/**/*.{ts,tsx}'],
    extends: [nextPlugin.configs['core-web-vitals'], reactHooks.configs.flat['recommended-latest']],
    settings: {
      next: { rootDir: 'packages/web/' },
    },
  },

  {
    name: 'aeolus/core-import-boundary',
    files: ['packages/server/src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: coreForbiddenImports.map(({ what, regex }) => ({
            regex,
            caseSensitive: true,
            message: coreBoundaryMessage(what),
          })),
        },
      ],
      // no-restricted-imports does not see import() expressions or import('x') types.
      'no-restricted-syntax': [
        'error',
        ...coreForbiddenImports.flatMap(({ what, regex }) => [
          { selector: `ImportExpression[source.value=${esqueryRegex(regex)}]`, message: coreBoundaryMessage(what) },
          { selector: `TSImportType[source.value=${esqueryRegex(regex)}]`, message: coreBoundaryMessage(what) },
        ]),
      ],
    },
  },
);
