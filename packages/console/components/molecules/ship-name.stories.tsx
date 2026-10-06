import { idSchema } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ShipName } from './ship-name';

const shipId = idSchema('ship').parse('shp_01j8xk4t9qf3m2n9xw5r6ryb4c');

const meta = {
  title: 'Molecules/ShipName',
  component: ShipName,
  args: { name: 'reviewer-01', shipId },
} satisfies Meta<typeof ShipName>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveShip: Story = {};
export const WithIdSuffix: Story = { args: { isSuffixShown: true } };
export const Argo: Story = { args: { name: 'argo', isOperator: true, isSuffixShown: true } };
export const Link: Story = { args: { name: 'planner', href: '#planner' } };
export const Truncated: Story = {
  args: { name: 'release-captain-eu-west-primary' },
  decorators: [
    (Story) => (
      <div className="flex w-36">
        <Story />
      </div>
    ),
  ],
};
export const TitleRetired: Story = { args: { size: 'title', isSuffixShown: true } };
export const MetaLine: Story = {
  args: { name: 'reviewer-02', size: 'meta', isSuffixShown: true },
  render: (args) => (
    <span className="inline-flex gap-1 text-meta text-muted-foreground">
      Claimed by <ShipName {...args} />
    </span>
  ),
};
