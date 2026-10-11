import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { blueprintChoices } from '../../../lib/squadrons-view';
import { BlueprintTable } from './blueprint-table';
import { blueprints, forming, sailing } from '../../../lib/fixtures/squadrons.fixtures';

const meta = {
  title: 'Organisms/BlueprintTable',
  component: BlueprintTable,
  args: { blueprints: blueprintChoices({ blueprints }), squadrons: [forming, sailing], state: 'ready', onRetry: () => undefined },
} satisfies Meta<typeof BlueprintTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { blueprints: [] } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = { args: { state: 'error', error: 'git fetch: could not resolve host' } };
