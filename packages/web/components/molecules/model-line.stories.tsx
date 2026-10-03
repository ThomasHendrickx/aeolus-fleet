import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ModelLine } from './model-line';

const meta = {
  title: 'Molecules/ModelLine',
  component: ModelLine,
  args: { harness: 'claude-code', model: 'claude-opus-5-5' },
} satisfies Meta<typeof ModelLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HarnessAndModel: Story = {};
export const OtherHarness: Story = { args: { harness: 'gemini cli' } };
export const ModelOnly: Story = { args: { harness: null } };
