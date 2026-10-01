import type { StorybookConfig } from '@storybook/nextjs-vite';

// The console's parts, each with a story per meaningful state (web-frontend skill).
const config: StorybookConfig = {
  framework: '@storybook/nextjs-vite',
  stories: ['../components/**/*.stories.tsx'],
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
