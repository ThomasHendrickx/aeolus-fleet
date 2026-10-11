import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/nextjs-vite';

/**
 * Where a package sits, from this folder: in the workspace Storybook may sit
 * at the root while its framework sits in the console's own node_modules, so
 * Storybook is given absolute paths, as its docs say for monorepos.
 */
function packagePath(name: string): string {
  return dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`)));
}

// The console's parts, each with a story per meaningful state (web-frontend skill).
const config: StorybookConfig = {
  framework: packagePath('@storybook/nextjs-vite'),
  stories: ['../components/**/*.stories.tsx', '../features/**/*.stories.tsx'],
  // Every story also runs as a test, in Vitest's browser mode (#303).
  addons: [packagePath('@storybook/addon-vitest')],
  core: { disableTelemetry: true },
  // Workspace packages resolve to their TypeScript source, as in Vitest and
  // typecheck (tsconfig.base.json), so Storybook needs no built common.
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    resolve: {
      ...viteConfig.resolve,
      conditions: [
        '@aeolus-fleet/source',
        ...(viteConfig.resolve?.conditions ?? ['module', 'browser', 'development|production']),
      ],
    },
  }),
};

export default config;
