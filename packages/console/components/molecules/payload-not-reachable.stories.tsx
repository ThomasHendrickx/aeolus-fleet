import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen } from 'storybook/test';

import { PayloadNotReachable } from './payload-not-reachable';

const meta = {
  title: 'Molecules/PayloadNotReachable',
  component: PayloadNotReachable,
} satisfies Meta<typeof PayloadNotReachable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In place of a sealed payload while the company key is cut off. */
export const KeyNotReachable: Story = {
  play: async () => {
    await expect(await screen.findByRole('note')).toHaveTextContent('Sealed, key not reachableThe payload is kept. It shows again once your company key is reachable.');
  },
};
/** On phone. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
