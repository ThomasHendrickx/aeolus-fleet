import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { DEFAULT_SQUADRON_VIEW } from '../lib/squadron-filter';
import { forming, sailing } from '../../../lib/fixtures/squadrons.fixtures';
import { SquadronTable } from './squadron-table';

const meta = {
  title: 'Organisms/SquadronTable',
  component: SquadronTable,
  args: {
    squadrons: [sailing, forming, { ...sailing, id: 'aeolus-z8y7x6', state: 'disbanded' }],
    state: 'ready',
    hasBlueprints: true,
    onRetry: () => undefined,
    onForm: () => undefined,
    view: DEFAULT_SQUADRON_VIEW,
    onViewChange: () => undefined,
  },
} satisfies Meta<typeof SquadronTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const EmptyWithBlueprints: Story = { args: { squadrons: [] } };
export const EmptyWithoutBlueprints: Story = { args: { squadrons: [], hasBlueprints: false } };
export const Loading: Story = { args: { state: 'loading' } };
export const LoadFailed: Story = { args: { state: 'error', error: 'squadrons did not answer: try again in a moment' } };
export const DisbandedShown: Story = { args: { view: { ...DEFAULT_SQUADRON_VIEW, isDisbandedShown: true } } };
export const NoResults: Story = { args: { view: { ...DEFAULT_SQUADRON_VIEW, query: 'nothing-like-it' } } };
