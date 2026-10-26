import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

// Workspace packages resolve to their TypeScript source in tests, like in the
// editor and in typecheck (see customConditions in tsconfig.base.json).
const conditions = ['@aeolus-fleet/source', 'module', 'node', 'development|production'];
// Vitest hands the server conditions to Node itself, which knows no `module`
// condition: with it, Node would load a package's bundler-only build, such as
// OpenTelemetry's, whose imports name no file extension.
const nodeConditions = conditions.filter((condition) => condition !== 'module');

/** The console's Storybook, whose every story runs as a test (#303). */
const storybookConfigDir = fileURLToPath(new URL('packages/console/.storybook', import.meta.url));

/**
 * The layers in the order a full run takes them, as each project's name ends
 * (`core:integration`). CI runs each layer as its own job; a full local run
 * takes them one after another too, so no layer's time limits compete with
 * another layer's servers, browsers and databases on the same machine (#499).
 */
const LAYERS = ['unit', 'stories', 'integration', 'e2e'];

function inLayerOrder(projects: TestProjectInlineConfiguration[]): TestProjectInlineConfiguration[] {
  return projects.map(withGroupOrder);
}

function withGroupOrder(project: TestProjectInlineConfiguration): TestProjectInlineConfiguration {
  const name = project.test?.name;
  const label = typeof name === 'object' ? name.label : (name ?? '');
  const groupOrder = LAYERS.indexOf(label.split(':').at(-1) ?? '');
  if (groupOrder === -1) {
    throw new Error(`the Vitest project ${label} is in no layer: name it <package>:<${LAYERS.join('|')}>`);
  }
  return { ...project, test: { ...project.test, sequence: { ...project.test?.sequence, groupOrder } } };
}

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions: nodeConditions } },
  test: {
    // Half the machine per run, not all of it but one core: the tests start
    // servers, browsers and databases beside their workers, and full runs of
    // other worktrees share the machine (#499).
    maxWorkers: '50%',
    // A poll's own default (1 second) holds only on an idle machine; a full
    // run shares its machine with servers, browsers and other runs (#499).
    expect: { poll: { timeout: 10_000 } },
    projects: inLayerOrder([
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
          setupFiles: ['src/testing/temporal-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'console:unit',
          root: 'packages/console',
          include: ['lib/**/*.test.ts', 'features/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'core:integration',
          root: 'packages/core',
          include: ['test/**/*.integration.test.ts'],
          globalSetup: ['src/testing/postgres-global-setup.ts'],
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
          // in development mode, driven by Playwright. Never a published plugin.
          name: 'console:e2e',
          include: ['e2e/**/*.e2e.test.ts'],
          // Each file starts its own next dev in packages/console; one at a time.
          fileParallelism: false,
          // Core and the console only: flows across trains are checked on staging, against the candidate.
          globalSetup: ['packages/core/src/testing/postgres-global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ]),
  },
});
