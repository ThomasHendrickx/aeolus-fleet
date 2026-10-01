import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CodeBlock } from './code-block';

const meta = {
  title: 'Atoms/CodeBlock',
  component: CodeBlock,
  decorators: [
    (Story) => (
      <div className="max-w-100">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Json: Story = {
  args: {
    label: 'JSON · 50 bytes',
    code: '{\n  "task": "review",\n  "repo": "web",\n  "pr": 321\n}',
    copyLabel: 'Copy payload',
  },
};

export const LongLineWrapped: Story = {
  args: {
    label: 'Starting prompt',
    isWrapped: true,
    code: 'You crew the Aeolus ship reviewer-01 (shp_01J8XK4T9QF3M2N9XW5R6YB4C). Your secret: aeolus_sk_v1_3Vn8Qe1Rt6Yu9Io2Pa5Sd7Fg',
  },
};
