import { configDefaults, defineConfig } from 'vitest/config';

// Workspace packages resolve to their TypeScript source in tests, like in the
// editor and in typecheck (see customConditions in tsconfig.base.json).
const conditions = ['@aeolus-fleet/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'scripts:unit',
          include: ['scripts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          // Each guardrail lint rule, proven against the real ESLint config.
          name: 'lint:unit',
          include: ['lint/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'common:unit',
          root: 'packages/common',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server:unit',
          root: 'packages/server',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'squadrons:unit',
          root: 'packages/squadrons',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'trierarch:unit',
          root: 'packages/trierarch',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web:unit',
          root: 'packages/web',
          include: ['lib/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          // The aeolus Claude Code plugin's bash scripts, run against a stub fleet.
          name: 'plugin:unit',
          root: 'plugins/aeolus',
          include: ['test/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'server:integration',
          root: 'packages/server',
          include: ['test/**/*.integration.test.ts'],
          globalSetup: ['test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          // Squadrons on Postgres, against a real fleet server, both in the shared container.
          name: 'squadrons:integration',
          root: 'packages/squadrons',
          include: ['test/**/*.integration.test.ts'],
          globalSetup: ['../server/test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          // The trierarch against a real fleet server, in the shared container.
          name: 'trierarch:integration',
          root: 'packages/trierarch',
          include: ['test/**/*.integration.test.ts'],
          globalSetup: ['../server/test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          // The console in a real browser: Postgres, the server and the web app
          // in development mode, driven by Playwright.
          name: 'web:e2e',
          include: ['e2e/**/*.e2e.test.ts'],
          // Each file starts its own next dev in packages/web; one at a time.
          fileParallelism: false,
          globalSetup: ['packages/server/test/postgres.global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
