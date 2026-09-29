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
          name: 'web:unit',
          root: 'packages/web',
          include: ['lib/**/*.test.ts'],
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
          // The console in a real browser: Postgres, the server and the web app
          // in development mode, driven by Playwright.
          name: 'web:e2e',
          include: ['e2e/**/*.e2e.test.ts'],
          globalSetup: ['packages/server/test/postgres.global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
