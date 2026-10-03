import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { forming, sailing } from './squadrons.fixtures';
import { SquadronTable } from './squadron-table';

const meta = {
  title: 'Organisms/SquadronTable',
  component: SquadronTable,
  args: { squadrons: [sailing, forming], state: 'ready', hasBlueprints: true, onRetry: () => undefined, onForm: () => undefined },
} satisfies Meta<typeof SquadronTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const EmptyWithBlueprints: Story = { args: { squadrons: [] } };
export const EmptyWithoutBlueprints: Story = { args: { squadrons: [], hasBlueprints: false } };
export const Loading: Story = { args: { state: 'loading' } };
export const LoadFailed: Story = { args: { state: 'error', error: 'squadrons did not answer: try again in a moment' } };
