import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus, Ship } from 'lucide-react';

import { Button } from '../atoms/button';
import { EmptyState } from './empty-state';

const meta = {
  title: 'Molecules/EmptyState',
  component: EmptyState,
  decorators: [
    (Story) => (
      <div className="max-w-120">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Page: Story = {
  args: {
    variant: 'page',
    icon: <Ship />,
    title: 'No ships besides argo yet',
    description: 'Commission a ship to add an agent to the fleet.',
    action: (
      <Button variant="primary" icon={<Plus aria-hidden />}>
        Commission your first ship
      </Button>
    ),
  },
};

export const Section: Story = {
  args: { variant: 'section', title: 'No open messages.', description: 'Everything is done.' },
};

export const NoResults: Story = {
  args: {
    variant: 'no-results',
    title: 'No ships match “deploy”.',
    action: <Button size="xs">Clear search</Button>,
  },
};
