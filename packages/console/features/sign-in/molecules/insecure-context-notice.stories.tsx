import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { InsecureContextNotice } from './insecure-context-notice';

const meta = {
  title: 'Molecules/InsecureContextNotice',
  component: InsecureContextNotice,
  decorators: [
    (Story) => (
      <div className="max-w-100">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InsecureContextNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
