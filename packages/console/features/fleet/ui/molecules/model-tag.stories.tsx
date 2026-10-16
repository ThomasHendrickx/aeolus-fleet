import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ModelTag } from './model-tag';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const STATED = new Date(NOW.getTime() - 10_000).toISOString();

const meta = {
  title: 'Molecules/ModelTag',
  component: ModelTag,
  args: { model: { id: 'claude-opus-5-5', statedAt: STATED }, isCrewed: true, now: NOW },
} satisfies Meta<typeof ModelTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Model: Story = {};
export const OtherVendor: Story = { args: { model: { id: 'gpt-6-sol', statedAt: STATED } } };
export const Software: Story = { args: { model: { id: '@aeolus-fleet/squadrons@0.12.0', statedAt: STATED } } };
export const ModelWithDate: Story = { args: { model: { id: 'claude-opus-4@20250514', statedAt: STATED } } };
export const NotStatedYet: Story = { args: { model: null } };
