import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SquadronActions } from './squadron-actions';

const meta = {
  title: 'Organisms/SquadronActions',
  component: SquadronActions,
  args: {
    squadronId: 'aeolus-a1b2c3',
    offered: { canAddMember: true, canMessageFlagship: true, canStandDown: true, canForceStandDown: true },
    onAddMember: () => undefined,
    onMessageFlagship: () => undefined,
    onStandDown: () => undefined,
    onForceStandDown: () => undefined,
  },
} satisfies Meta<typeof SquadronActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sailing: Story = {};

/** Forming: Message to the flagship and Force stand down only. */
export const Forming: Story = {
  args: { offered: { canAddMember: false, canMessageFlagship: true, canStandDown: false, canForceStandDown: true } },
};

/** A viewer's session: the menu holds Copy squadron id alone. */
export const ReadOnly: Story = {
  args: { offered: { canAddMember: false, canMessageFlagship: false, canStandDown: false, canForceStandDown: false } },
};

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
