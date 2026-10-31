import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { UsagePartialNotice } from './usage-partial-notice';

const meta = {
  title: 'Usage/UsagePartialNotice',
  component: UsagePartialNotice,
  args: { machines: ['trierarch-macbook'] },
} satisfies Meta<typeof UsagePartialNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneMachine: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-partial')).toHaveTextContent('trierarch-macbook sends no usage in this range.');
  },
};

export const SeveralMachines: Story = {
  args: { machines: ['trierarch-macbook', 'trierarch-new'] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-partial')).toHaveTextContent('trierarch-macbook, trierarch-new send no usage in this range.');
  },
};

/** Every machine sends usage: nothing shows. */
export const NoMachine: Story = {
  args: { machines: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('usage-partial')).toBeNull();
  },
};

export const OneMachineDark: Story = { ...OneMachine, globals: { theme: 'dark' } };
