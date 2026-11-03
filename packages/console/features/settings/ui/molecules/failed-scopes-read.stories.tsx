import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { FailedScopesRead } from './failed-scopes-read';

const meta = {
  title: 'Molecules/FailedScopesRead',
  component: FailedScopesRead,
  args: { plugin: 'the trierarch plugin', shipName: 'trierarch-plugin', reason: 'The fleet did not answer', isRetrying: false, onRetry: fn() },
} satisfies Meta<typeof FailedScopesRead>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Failed: Story = {};
export const Retrying: Story = { args: { isRetrying: true } };
