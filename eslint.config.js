// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/*
 * The guardrails (slice 1b): what CLAUDE.md and the skills ask for, enforced
 * here so it never depends on an agent remembering. Each rule is proven by a
 * test in lint/ that fails when the rule is removed.
 *
 * Several guardrails use the same ESLint rule (no-restricted-imports and its
 * siblings) on overlapping files, and ESLint keeps only the last options it
 * finds for a rule. So the restrictions are lists, and every block below
 * passes the complete set for its files.
 */

/** @typedef {{ regex: string, message: string }} ImportRestriction */
/** @typedef {{ selector: string, message: string }} SyntaxRestriction */
/** @typedef {{ object: string, property: string, message: string }} PropertyRestriction */
/** @typedef {{ name: string, importNames: string[], message: string }} PathRestriction */

/**
 * What server/src/core must never import (CLAUDE.md, "Architecture rules").
 * @type {ImportRestriction[]}
 */
const coreForbiddenImports = [
  { what: 'Prisma', regex: '^(prisma|prisma/.+|@prisma/.+|\\.prisma/.+)$' },
  { what: 'pg', regex: '^pg([-/].+)?$' },
  { what: 'Fastify', regex: '^(fastify|fastify/.+|fastify-.+|@fastify/.+)$' },
  { what: 'tRPC', regex: '^@trpc/.+$' },
  { what: 'an adapter', regex: '(^|/)adapters(/|$)' },
  { what: 'the server package entry, which re-exports adapters', regex: '^@aeolus-fleet/server(/.+)?$' },
].map(({ what, regex }) => ({
  regex,
  message: `server/src/core must not import ${what}. The core holds domain, use cases and ports; adapters depend on it, never the other way round.`,
}));

const clockMessage = 'server/src/core never reads the clock: take `now` from the Clock port or as input.';
const cryptoMessage = 'server/src/core never uses crypto: hashing and random tokens are ports (SecretHasher, RandomTokens).';

/** The core is deterministic and never throws (domain-modelling and typescript skills). */
const coreImpure = {
  /** @type {ImportRestriction[]} */
  imports: [{ regex: '^(node:)?crypto$', message: cryptoMessage }],
  /** @type {SyntaxRestriction[]} */
  syntax: [
    { selector: 'NewExpression[callee.name="Date"][arguments.length=0]', message: clockMessage },
    { selector: 'CallExpression[callee.name="Date"]', message: clockMessage },
    {
      selector: 'ThrowStatement',
      message:
        'server/src/core never throws: return a Result with a domain error kind. Only adapters throw, for system failures.',
    },
  ],
  /** @type {PropertyRestriction[]} */
  properties: [
    { object: 'Date', property: 'now', message: clockMessage },
    {
      object: 'Math',
      property: 'random',
      message: 'server/src/core never makes randomness: use the IdGenerator or RandomTokens port.',
    },
    { object: 'globalThis', property: 'crypto', message: cryptoMessage },
  ],
  globals: [{ name: 'crypto', message: cryptoMessage }],
};

/** The bounded contexts in server/src/core. `shared` is open to all of them. */
const coreContexts = ['registry', 'messaging', 'identity'];

/**
 * From inside one context, another context is reachable only through its
 * public.ts (docs/architecture.md, "Code structure").
 * @param {string} context
 * @returns {ImportRestriction[]}
 */
function otherContextsInternals(context) {
  return coreContexts
    .filter((other) => other !== context)
    .map((other) => ({
      regex: `(^|/)${other}/(?!public\\.js$)`,
      message: `core/${context} imports core/${other} only through ${other}/public.js, its published surface.`,
    }));
}

// esquery regex literals cannot contain a slash, so write it as \x2F.
const esqueryRegex = (/** @type {string} */ regex) => `/${regex.replaceAll('/', '\\x2F')}/`;

/**
 * no-restricted-imports does not see import() expressions or import('x') types,
 * so each import restriction is also a syntax restriction.
 * @param {ImportRestriction[]} restrictions
 * @returns {SyntaxRestriction[]}
 */
function dynamicImports(restrictions) {
  return restrictions.flatMap(({ regex, message }) => [
    { selector: `ImportExpression[source.value=${esqueryRegex(regex)}]`, message },
    { selector: `TSImportType[source.value=${esqueryRegex(regex)}]`, message },
  ]);
}

/**
 * Every import restriction for a set of files, static and dynamic, plus any
 * other syntax restriction for the same files.
 * @param {{ patterns: ImportRestriction[], paths?: PathRestriction[], syntax?: SyntaxRestriction[] }} restrictions
 */
function importRules({ patterns, paths = [], syntax = [] }) {
  return {
    'no-restricted-imports': [
      'error',
      { paths, patterns: patterns.map(({ regex, message }) => ({ regex, caseSensitive: true, message })) },
    ],
    'no-restricted-syntax': ['error', ...dynamicImports(patterns), ...syntax],
  };
}

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

  ...['registry', 'messaging', 'identity', 'shared'].map((context) => ({
    name: `aeolus/core-${context}`,
    files: [`packages/server/src/core/${context}/**/*.ts`],
    rules: {
      ...importRules({
        patterns: [...coreForbiddenImports, ...coreImpure.imports, ...otherContextsInternals(context)],
        syntax: coreImpure.syntax,
      }),
      'no-restricted-properties': ['error', ...coreImpure.properties],
      'no-restricted-globals': ['error', ...coreImpure.globals],
    },
  })),

  {
    name: 'aeolus/web',
    files: ['packages/web/**/*.{ts,tsx}'],
    extends: [nextPlugin.configs['core-web-vitals'], reactHooks.configs.flat['recommended-latest']],
    settings: {
      next: { rootDir: 'packages/web/' },
    },
  },
);
