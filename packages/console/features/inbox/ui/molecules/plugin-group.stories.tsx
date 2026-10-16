import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { DISCARDED, KEPT, NOW } from '../../../../lib/fixtures/inbox.fixtures';
import { PluginGroup } from './plugin-group';

const meta = {
  title: 'Molecules/PluginGroup',
  component: PluginGroup,
  args: { messages: [DISCARDED, KEPT], isExpanded: false, onToggle: fn(), selectedId: undefined, onSelect: fn(), onDoneAll: fn(), now: NOW },
  decorators: [(Story) => <ul className="max-w-sm">{Story()}</ul>],
} satisfies Meta<typeof PluginGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One row: who sent them, how many, and their headlines. */
export const Folded: Story = {};

/** Each message a row of its own, and Done for the group. */
export const Unfolded: Story = { args: { isExpanded: true } };

export const DonePending: Story = { args: { isExpanded: true, isPending: true } };

/** Nothing to mark done (Done segment, or a viewer): no Done. */
export const UnfoldedReadOnly: Story = { args: { isExpanded: true, onDoneAll: undefined } };
