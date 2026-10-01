import type { StorybookConfig } from '@storybook/nextjs-vite';

// The console's parts, each with a story per meaningful state (web-frontend skill).
const config: StorybookConfig = {
  framework: '@storybook/nextjs-vite',
  stories: ['../components/**/*.stories.tsx'],
  core: { disableTelemetry: true },
};

export default config;
