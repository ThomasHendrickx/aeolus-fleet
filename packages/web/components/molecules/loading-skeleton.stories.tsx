import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { LoadingSkeleton } from './loading-skeleton';

const meta = {
  title: 'Molecules/LoadingSkeleton',
  component: LoadingSkeleton,
  decorators: [
    (Story) => (
      <div className="max-w-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LoadingSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Table: Story = { args: { variant: 'table' } };
export const Cards: Story = { args: { variant: 'cards' } };
export const Detail: Story = { args: { variant: 'detail' } };
export const PhoneList: Story = { args: { variant: 'list', rows: 3 } };
