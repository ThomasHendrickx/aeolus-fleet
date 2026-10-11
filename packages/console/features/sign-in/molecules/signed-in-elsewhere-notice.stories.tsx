import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SignedInElsewhereNotice } from './signed-in-elsewhere-notice';

const meta = {
  title: 'Molecules/SignedInElsewhereNotice',
  component: SignedInElsewhereNotice,
  decorators: [
    (Story) => (
      <div className="max-w-100">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SignedInElsewhereNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
