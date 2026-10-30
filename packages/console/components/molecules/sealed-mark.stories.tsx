import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen } from 'storybook/test';

import { SealedMark } from './sealed-mark';

const meta = {
  title: 'Molecules/SealedMark',
  component: SealedMark,
} satisfies Meta<typeof SealedMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Beside a payload: the lock and the word. */
export const Word: Story = {
  play: async () => {
    await expect(await screen.findByText('Sealed')).toBeVisible();
  },
};
/** By a list row's time or line: the lock alone, named Sealed. */
export const Icon: Story = {
  args: { variant: 'icon' },
  play: async () => {
    await expect(await screen.findByRole('img', { name: 'Sealed' })).toBeVisible();
  },
};
