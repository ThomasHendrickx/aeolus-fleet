import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Kbd } from './kbd';

const meta = {
  title: 'Atoms/Kbd',
  component: Kbd,
  args: { children: '⌘K' },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One shortcut: the CommandPalette's. */
export const Single: Story = {};

/** A sequence with its word: the palette's footer hints. */
export const Sequence: Story = {
  render: () => (
    <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd>
      Move
    </span>
  ),
};
