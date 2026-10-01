import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { LocationTag } from './location-tag';

const meta = {
  title: 'Molecules/LocationTag',
  component: LocationTag,
} satisfies Meta<typeof LocationTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Device: Story = { args: { kind: 'DEVICE' } };
export const Cloud: Story = { args: { kind: 'CLOUD' } };
export const Server: Story = { args: { kind: 'SERVER' } };
export const Other: Story = { args: { kind: 'OTHER', description: 'CI runner' } };
export const NotCrewed: Story = { args: { kind: null } };
export const Compact: Story = { args: { kind: 'OTHER', description: 'CI runner', isCompact: true } };
export const Phone: Story = { args: { kind: 'OTHER', description: 'CI runner', size: 'sm' } };
