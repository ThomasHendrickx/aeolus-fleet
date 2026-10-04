import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { TemplateRepositories } from './template-repositories';

const NOW = new Date('2026-10-04T12:00:00.000Z');

const meta = {
  title: 'Organisms/TemplateRepositories',
  component: TemplateRepositories,
  args: {
    repositories: [
      {
        name: 'github.com/acme/squadron-templates',
        url: 'https://github.com/acme/squadron-templates.git',
        path: '.aeolus/squadrons',
        hasToken: false,
        addedAt: '2026-10-03T09:00:00.000Z',
        lastFetch: { at: '2026-10-04T11:58:00.000Z', error: null },
      },
      {
        name: 'gitlab.example.com/ops/fleet',
        url: 'https://gitlab.example.com/ops/fleet.git',
        path: 'ops/fleet',
        hasToken: true,
        addedAt: '2026-10-03T09:00:00.000Z',
        lastFetch: { at: '2026-10-04T11:58:00.000Z', error: 'git fetch: could not resolve host' },
      },
    ],
    state: 'ready',
    onRetry: () => undefined,
    isAdding: false,
    onAdd: () => undefined,
    isRemoving: false,
    onRemove: () => undefined,
    onRemoveClosed: () => undefined,
    isRefreshing: false,
    onRefresh: () => undefined,
    now: NOW,
  },
} satisfies Meta<typeof TemplateRepositories>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { repositories: [] } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = { args: { state: 'error', error: 'squadrons did not answer.' } };
export const AddRefused: Story = { args: { addError: 'A repository URL must be https.' } };
