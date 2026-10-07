import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

// Workspace packages resolve to their TypeScript source in tests, like in the
// editor and in typecheck (see customConditions in tsconfig.base.json).
const conditions = ['@aeolus-fleet/source', 'module', 'node', 'development|production'];

/** The console's Storybook, whose every story runs as a test (#303). */
const storybookConfigDir = fileURLToPath(new URL('packages/console/.storybook', import.meta.url));

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
          name: 'core:unit',
          root: 'packages/core',
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
          name: 'trierarch-plugin:unit',
          root: 'packages/trierarch-plugin',
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
          name: 'console:unit',
          root: 'packages/console',
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
          name: 'core:integration',
          root: 'packages/core',
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
          globalSetup: ['../core/test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          // The trierarch plugin on Postgres, against a real fleet server, both in the shared container.
          name: 'trierarch-plugin:integration',
          root: 'packages/trierarch-plugin',
          include: ['test/**/*.integration.test.ts'],
          globalSetup: ['../core/test/postgres.global-setup.ts'],
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
          globalSetup: ['../core/test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
      {
        // Every Storybook story of the console as a test, in Chromium: each
        // renders without errors, and each play function runs (#303). Its own
        // Vite config comes from Storybook's, for the browser, so it does not
        // extend the Node one above. CHROMIUM_EXECUTABLE_PATH points at a
        // Chromium a machine has already, as for the end-to-end tests.
        plugins: [storybookTest({ configDir: storybookConfigDir })],
        test: {
          name: 'console:stories',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(process.env.CHROMIUM_EXECUTABLE_PATH === undefined ? {} : { launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        extends: true,
        test: {
          // The console in a real browser: Postgres, the server and the web app
          // in development mode, driven by Playwright.
          name: 'console:e2e',
          include: ['e2e/**/*.e2e.test.ts'],
          // Each file starts its own next dev in packages/console; one at a time.
          fileParallelism: false,
          globalSetup: ['packages/core/test/postgres.global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
