import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { DeliveryHistory } from './delivery-history';
import { DIRECT_HISTORY, REVIEWER, TYPE_HISTORY, UNDELIVERABLE_HISTORY } from '../../../lib/fixtures/ship-page.fixtures';

const meta = {
  title: 'Organisms/DeliveryHistory',
  component: DeliveryHistory,
  args: { entries: DIRECT_HISTORY, recipient: { kind: 'ship', ship: REVIEWER } },
  decorators: [
    (Story) => (
      <div className="max-w-120 rounded-lg border border-border bg-card p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DeliveryHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Direct: Story = {};
export const TypeAddressed: Story = { args: { entries: TYPE_HISTORY, recipient: { kind: 'type', type: 'reviewer' } } };
export const Undeliverable: Story = { args: { entries: UNDELIVERABLE_HISTORY } };
export const JustStored: Story = { args: { entries: DIRECT_HISTORY.slice(-1) } };
