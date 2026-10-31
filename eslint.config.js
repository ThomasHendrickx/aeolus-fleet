// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import checkFile from 'eslint-plugin-check-file';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import reactX from 'eslint-plugin-react-x';
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

/** @type {ImportRestriction[]} */
const prismaOutsideItsAdapter = [
  { regex: '^@prisma/', message: '@prisma/* is imported only in the prisma adapter.' },
  { regex: '^pg([-/].+)?$', message: 'pg is imported only in the prisma adapter.' },
];

/**
 * What core/src/domain must never import (CLAUDE.md, "Architecture rules").
 * It includes Prisma and pg, so the core needs no other list for them.
 * @type {ImportRestriction[]}
 */
const coreForbiddenImports = [
  { what: 'Prisma', regex: '^(prisma|prisma/.+|@prisma/.+|\\.prisma/.+)$' },
  { what: 'pg', regex: '^pg([-/].+)?$' },
  { what: 'Fastify', regex: '^(fastify|fastify/.+|fastify-.+|@fastify/.+)$' },
  { what: 'tRPC', regex: '^@trpc/.+$' },
  { what: 'an adapter', regex: '(^|/)adapters(/|$)' },
  { what: 'the core package entry, which re-exports adapters', regex: '^@aeolus-fleet/core(/.+)?$' },
].map(({ what, regex }) => ({
  regex,
  message: `core/src/domain must not import ${what}. The core holds domain, use cases and ports; adapters depend on it, never the other way round.`,
}));

const clockMessage = 'core/src/domain never reads the clock: take `now` from the Clock port or as input.';
const cryptoMessage = 'core/src/domain never uses crypto: hashing and random tokens are ports (SecretHasher, RandomTokens).';

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
        'core/src/domain never throws: return a Result with a domain error kind. Only adapters throw, for system failures.',
    },
  ],
  /** @type {PropertyRestriction[]} */
  properties: [
    { object: 'Date', property: 'now', message: clockMessage },
    {
      object: 'Math',
      property: 'random',
      message: 'core/src/domain never makes randomness: use the IdGenerator or RandomTokens port.',
    },
    { object: 'globalThis', property: 'crypto', message: cryptoMessage },
  ],
  globals: [{ name: 'crypto', message: cryptoMessage }],
};

/** The bounded contexts in core/src/domain. `shared` is open to all of them. */
const coreContexts = ['registry', 'messaging', 'identity'];

/**
 * From anywhere else in core, a context is reachable only through its
 * public.ts (docs/architecture.md, "Code structure").
 * @param {string} [context] the context the importing file belongs to, if any
 * @returns {ImportRestriction[]}
 */
function otherContextsInternals(context) {
  return coreContexts
    .filter((other) => other !== context)
    .map((other) => ({
      regex: `(^|/)${other}/(?!public\\.js$)`,
      message: `Outside domain/${other}, import it only through ${other}/public.js, its published surface.`,
    }));
}

/**
 * Every restriction for a file in core: the import boundary, purity and the
 * context boundaries seen from the given context.
 * @param {string} [context]
 */
function coreRules(context) {
  return {
    ...importRules({
      patterns: [...coreForbiddenImports, ...coreImpure.imports, ...otherContextsInternals(context)],
      syntax: coreImpure.syntax,
    }),
    'no-restricted-properties': ['error', ...noModuleMocks, ...noTestDoubles, ...coreImpure.properties],
    'no-restricted-globals': ['error', ...coreImpure.globals],
  };
}

/** @type {ImportRestriction} */
const coreFromTheRouterDoors = {
  regex: '(^|/)domain(/|$)',
  message: 'adapters/rest and adapters/mcp never import src/domain: they map onto the tRPC router (ADR 0004).',
};

/**
 * The console's atomic design layers, lowest first, in components/ (shared)
 * and in each features/<feature>/ui/ (web-frontend skill). Pages and their
 * route layouts in app/ compose them.
 */
const webLayers = ['atoms', 'molecules', 'organisms'];

/**
 * Features still in the old layout: atoms/, molecules/, organisms/ and lib/ at
 * the feature root. A feature leaves this list when a change touching it moves
 * it to ui/, state/, hooks/ and services/; a new feature never joins it.
 */
const featuresInTheOldLayout = [
  'compose',
  'guide',
  'labels',
  'notices',
  'ship-actions',
];

const newFeatureLayout = 'packages/console/features/*/@(ui/@(atoms|molecules|organisms)|state|hooks|services)/**';

/**
 * @param {string} layer
 * @returns {ImportRestriction[]}
 */
function upwardImports(layer) {
  const above = webLayers.slice(webLayers.indexOf(layer) + 1);
  return above.length === 0
    ? []
    : [{ regex: `^\\.\\./(${above.join('|')})(/|$)`, message: `${layer} never import ${above.join(' or ')}: atomic design imports downward only.` }];
}

/** @type {ImportRestriction} */
const sharedImportsAFeature = {
  regex: '^(\\.\\./)+(features|app)(/|$)',
  message: 'Shared code (components/, lib/) never imports a feature or app/: what a second feature needs moves to shared, props only.',
};

const featureImportsAnotherMessage = 'A feature never imports another: app/ composes them, passing one into another as a slot or props.';

/** @type {ImportRestriction} */
const featureImportsAnother = { regex: '^\\.\\./\\.\\./[^./][^/]*(/|$)', message: featureImportsAnotherMessage };

/**
 * The same, seen from a feature's ui/<layer>/, one folder deeper.
 * @type {ImportRestriction}
 */
const uiImportsAnotherFeature = { regex: '^\\.\\./\\.\\./\\.\\./[^./][^/]*(/|$)', message: featureImportsAnotherMessage };

const propsOnlyMessage =
  "Shared components, a feature's ui/ and, in the old layout, its atoms and molecules take props only: no tRPC and no hooks. Data arrives through the feature's state/ containers, or in the old layout its organisms' hooks.";

/** @type {ImportRestriction} */
const featureHooks = { regex: '^\\.\\./hooks(/|$)', message: propsOnlyMessage };

/** @type {ImportRestriction} */
const uiHooksAndState = { regex: '^\\.\\./\\.\\./(hooks|state)(/|$)', message: propsOnlyMessage };

/** @type {ImportRestriction[]} */
const trpcInPresentationalLayers = [
  { regex: '^@trpc/', message: propsOnlyMessage },
  { regex: '^@aeolus-fleet/core$', message: propsOnlyMessage },
  { regex: '(^|/)lib/trpc(\\.[jt]sx?)?$', message: propsOnlyMessage },
];

const noManualMemoMessage = 'No manual memoisation in the console unless measured: drop useMemo, useCallback and memo.';
const manualMemo = ['useMemo', 'useCallback', 'memo'];
/** @type {PathRestriction[]} */
const reactManualMemo = [{ name: 'react', importNames: manualMemo, message: noManualMemoMessage }];

const browserStorageMessage =
  'The console keeps no state in browser storage: server data comes through tRPC, view state lives in the URL, and the session is an httpOnly cookie.';

const webImpure = {
  /** @type {PropertyRestriction[]} */
  properties: [
    ...['window', 'globalThis', 'self'].flatMap((object) =>
      ['localStorage', 'sessionStorage'].map((property) => ({ object, property, message: browserStorageMessage })),
    ),
    ...manualMemo.map((property) => ({ object: 'React', property, message: noManualMemoMessage })),
  ],
  globals: [
    { name: 'localStorage', message: browserStorageMessage },
    { name: 'sessionStorage', message: browserStorageMessage },
  ],
};

const uiMessage =
  '@aeolus-fleet/ui is pure UI for the browser (UI package design UP4, decision 0033): it imports no app and no @aeolus-fleet package but common, common by import type only, and no zod, Node built-in, tRPC, TanStack or Next.js.';

/**
 * What ui's production files never import, not even as a type.
 * @type {ImportRestriction[]}
 */
const uiForbiddenImports = [
  { regex: '^zod(/.*)?$', message: uiMessage },
  { regex: '^node:', message: uiMessage },
  { regex: '^@trpc/', message: uiMessage },
  { regex: '^@tanstack/', message: uiMessage },
  { regex: '^next(/.*)?$', message: uiMessage },
  { regex: '^@aeolus-fleet/(?!common(/|$))', message: uiMessage },
];

/**
 * Common, which ui takes as types only.
 * @type {ImportRestriction[]}
 */
const commonInUi = [{ regex: '^@aeolus-fleet/common(/.*)?$', message: uiMessage }];

const uiFetchMessage = '@aeolus-fleet/ui takes props only: each app reads its data behind its own hooks and hands the part what to show.';

/** ui reads no data: no fetch, and no browser storage (webImpure). */
const uiImpure = {
  /** @type {PropertyRestriction[]} */
  properties: [...webImpure.properties, ...['window', 'globalThis', 'self'].map((object) => ({ object, property: 'fetch', message: uiFetchMessage }))],
  globals: [...webImpure.globals, { name: 'fetch', message: uiFetchMessage }],
};

const uiByItsEntryMessage = 'An app takes @aeolus-fleet/ui by its entry only, never by a path into the package.';

/**
 * How an app may not reach into ui: a subpath other than its stylesheets, or a relative path into packages/ui.
 * @type {ImportRestriction[]}
 */
const uiByItsEntry = [
  { regex: '^@aeolus-fleet/ui/(?!(tokens|theme)\\.css$)', message: uiByItsEntryMessage },
  { regex: '^(\\.\\./)+ui/src(/|$)', message: uiByItsEntryMessage },
];

/**
 * A value import, re-export or import() of these: an import type is erased,
 * so it is no import at all.
 * @param {ImportRestriction[]} restrictions
 * @returns {SyntaxRestriction[]}
 */
function valueImports(restrictions) {
  return restrictions.flatMap(({ regex, message }) => [
    { selector: `ImportDeclaration[importKind="value"][source.value=${esqueryRegex(regex)}]`, message },
    { selector: `ExportNamedDeclaration[exportKind="value"][source.value=${esqueryRegex(regex)}]`, message },
    { selector: `ExportAllDeclaration[exportKind="value"][source.value=${esqueryRegex(regex)}]`, message },
    { selector: `ImportExpression[source.value=${esqueryRegex(regex)}]`, message },
  ]);
}

/**
 * Every import restriction for ui's production files in a layer, or outside
 * the layers when none is given.
 * @param {string} [layer]
 */
function uiRules(layer) {
  return importRules({
    patterns: [...prismaOutsideItsAdapter, ...uiForbiddenImports, ...(layer === undefined ? [] : upwardImports(layer))],
    paths: reactManualMemo,
    syntax: valueImports(commonInUi),
  });
}

const commonWithoutReactMessage =
  'common holds no React: the UI parts live in @aeolus-fleet/ui, so common stays zod alone and server-only users never install or load React (UI package design UP1).';

/** @type {ImportRestriction[]} */
const reactInCommon = [
  { regex: '^(react|react-dom)(/.*)?$|^@base-ui/react(/.*)?$|^lucide-react$', message: commonWithoutReactMessage },
  { regex: '^@aeolus-fleet/ui(/.*)?$', message: commonWithoutReactMessage },
];

/** @type {PropertyRestriction[]} */
const noModuleMocks = ['mock', 'doMock'].map((property) => ({
  object: 'vi',
  property,
  message: 'No module mocks: hand-write an in-memory fake of the port and assert outcomes (behaviour-driven-development skill).',
}));

/**
 * Core and common are tested with hand-written in-memory fakes, asserting
 * outcomes and stored state, not calls. Adapters (CLI, I/O) may use them.
 * @type {PropertyRestriction[]}
 */
const noTestDoubles = ['fn', 'spyOn'].map((property) => ({
  object: 'vi',
  property,
  message:
    'No vi.fn or vi.spyOn in core and common: hand-write an in-memory fake and assert outcomes and stored state, not calls (behaviour-driven-development skill).',
}));

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
    '**/storybook-static/',
    '**/next-env.d.ts',
    'packages/core/src/adapters/prisma/generated/',
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
    name: 'aeolus/all-packages',
    plugins: { 'check-file': checkFile },
    rules: {
      'max-params': 'off',
      '@typescript-eslint/max-params': ['error', { max: 2 }],
      'no-restricted-exports': [
        'error',
        { restrictDefaultExports: { direct: true, named: true, defaultFrom: true, namedFrom: true, namespaceFrom: true } },
      ],
      // Dotted suffixes such as .test and .global-setup are not checked.
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{js,ts,tsx}': 'KEBAB_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'no-restricted-properties': ['error', ...noModuleMocks],
    },
  },
  {
    name: 'aeolus/all-packages-typed',
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        // A destructured name is its source's name, checked where that is declared.
        { selector: ['variable', 'parameter'], modifiers: ['destructured'], types: ['boolean'], format: null },
        {
          selector: ['variable', 'parameter', 'classProperty', 'parameterProperty', 'typeProperty', 'accessor'],
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'can', 'should', 'was', 'did'],
        },
      ],
    },
  },
  {
    // Next.js reads these files' default export, and tools read their config files the same way.
    name: 'aeolus/default-export-required',
    files: [
      'packages/console/app/**/{page,layout,loading,error,not-found,global-error,template,default}.tsx',
      '**/*.config.{js,ts}',
      // Storybook reads a story file's default export (its meta) and its configuration's.
      'packages/console/{components,features}/**/*.stories.tsx',
      'packages/ui/src/**/*.stories.tsx',
      'packages/{console,ui}/.storybook/{main,preview}.{ts,tsx}',
    ],
    rules: { 'no-restricted-exports': 'off' },
  },

  {
    name: 'aeolus/common',
    files: ['packages/common/**/*.{ts,tsx}'],
    rules: { 'no-restricted-properties': ['error', ...noModuleMocks, ...noTestDoubles] },
  },
  {
    // ui's parts keep the console's React guardrails (UI package design 5.4).
    name: 'aeolus/ui-web',
    files: ['packages/ui/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], jsxA11y.configs.recommended],
    plugins: { 'react-x': reactX },
    rules: {
      'react-x/no-array-index-key': 'error',
      ...importRules({ patterns: [], paths: reactManualMemo }),
      'no-restricted-properties': ['error', ...noModuleMocks, ...uiImpure.properties],
      'no-restricted-globals': ['error', ...uiImpure.globals],
    },
  },

  {
    name: 'aeolus/prisma-in-its-adapter',
    ignores: ['packages/core/src/adapters/prisma/**'],
    rules: importRules({ patterns: prismaOutsideItsAdapter }),
  },
  {
    // ui's production files; its tests and stories never ship (tsconfig.build.json).
    name: 'aeolus/ui',
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.stories.tsx'],
    rules: uiRules(),
  },
  // A layer imports only below itself, as the console's (UI package design 5.2).
  ...webLayers.map((layer) => ({
    name: `aeolus/ui-${layer}`,
    files: [`packages/ui/src/${layer}/**/*.{ts,tsx}`],
    ignores: ['**/*.test.ts', '**/*.stories.tsx'],
    rules: uiRules(layer),
  })),
  {
    name: 'aeolus/common-without-react',
    files: ['packages/common/src/**/*.{ts,tsx}'],
    rules: importRules({ patterns: [...prismaOutsideItsAdapter, ...reactInCommon] }),
  },

  // Every file in core, shared and any folder that is not a context included;
  // then each context, which may import its own modules.
  {
    name: 'aeolus/core',
    files: ['packages/core/src/domain/**/*.ts'],
    rules: coreRules(),
  },
  ...coreContexts.map((context) => ({
    name: `aeolus/core-${context}`,
    files: [`packages/core/src/domain/${context}/**/*.ts`],
    rules: coreRules(context),
  })),

  {
    name: 'aeolus/router-doors',
    files: ['packages/core/src/adapters/{rest,mcp}/**/*.ts'],
    rules: importRules({ patterns: [...prismaOutsideItsAdapter, coreFromTheRouterDoors] }),
  },

  {
    name: 'aeolus/web',
    files: ['packages/console/**/*.{ts,tsx}'],
    extends: [
      nextPlugin.configs['core-web-vitals'],
      reactHooks.configs.flat['recommended-latest'],
      jsxA11y.configs.recommended,
    ],
    plugins: { 'react-x': reactX },
    settings: {
      next: { rootDir: 'packages/console/' },
    },
    rules: {
      'react-x/no-array-index-key': 'error',
      ...importRules({ patterns: [...prismaOutsideItsAdapter, ...uiByItsEntry], paths: reactManualMemo }),
      'no-restricted-properties': ['error', ...noModuleMocks, ...webImpure.properties],
      'no-restricted-globals': ['error', ...webImpure.globals],
    },
  },
  {
    name: 'aeolus/web-lib',
    files: ['packages/console/lib/**/*.{ts,tsx}'],
    rules: importRules({ patterns: [...prismaOutsideItsAdapter, ...uiByItsEntry, sharedImportsAFeature], paths: reactManualMemo }),
  },
  ...webLayers.map((layer) => ({
    name: `aeolus/web-shared-${layer}`,
    files: [`packages/console/components/${layer}/**/*.{ts,tsx}`],
    rules: importRules({
      patterns: [...prismaOutsideItsAdapter, ...uiByItsEntry, ...upwardImports(layer), sharedImportsAFeature, ...trpcInPresentationalLayers],
      paths: reactManualMemo,
    }),
  })),
  {
    name: 'aeolus/web-features',
    files: ['packages/console/features/**/*.{ts,tsx}'],
    rules: importRules({ patterns: [...prismaOutsideItsAdapter, ...uiByItsEntry, featureImportsAnother], paths: reactManualMemo }),
  },
  ...webLayers.map((layer) => ({
    name: `aeolus/web-feature-${layer}`,
    files: [`packages/console/features/*/${layer}/**/*.{ts,tsx}`],
    rules: importRules({
      patterns: [
        ...prismaOutsideItsAdapter,
        ...uiByItsEntry,
        ...upwardImports(layer),
        featureImportsAnother,
        ...(layer === 'atoms' || layer === 'molecules' ? [...trpcInPresentationalLayers, featureHooks] : []),
      ],
      paths: reactManualMemo,
    }),
  })),
  ...webLayers.map((layer) => ({
    name: `aeolus/web-feature-ui-${layer}`,
    files: [`packages/console/features/*/ui/${layer}/**/*.{ts,tsx}`],
    rules: importRules({
      patterns: [
        ...prismaOutsideItsAdapter,
        ...uiByItsEntry,
        ...upwardImports(layer),
        uiImportsAnotherFeature,
        ...trpcInPresentationalLayers,
        uiHooksAndState,
      ],
      paths: reactManualMemo,
    }),
  })),
  {
    name: 'aeolus/web-feature-layout',
    files: ['packages/console/features/**/*.{ts,tsx}'],
    ignores: featuresInTheOldLayout.map((feature) => `packages/console/features/${feature}/**`),
    rules: {
      'check-file/folder-match-with-fex': [
        'error',
        { '*.{ts,tsx}': newFeatureLayout },
        {
          errorMessage:
            'A new feature uses ui/atoms, ui/molecules, ui/organisms, state/, hooks/ and services/ (web-frontend skill). The old layout stays only in featuresInTheOldLayout.',
        },
      ],
    },
  },
);
