import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Avatar } from './avatar';

const meta = {
  title: 'Atoms/Avatar',
  component: Avatar,
  args: { name: 'reviewer-01', size: 28 },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const App: Story = { args: { kind: 'app' } };
export const Account: Story = { args: { kind: 'account', name: 'operator' } };
export const Ship: Story = { args: { kind: 'ship' } };
export const Argo: Story = { args: { kind: 'argo', name: 'argo' } };
export const Retired: Story = { args: { kind: 'retired', name: 'docker' } };
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Avatar name="reviewer-01" size={20} />
      <Avatar name="reviewer-01" size={28} />
      <Avatar name="reviewer-01" size={36} />
    </div>
  ),
};
