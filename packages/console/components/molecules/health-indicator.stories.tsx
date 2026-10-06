import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { HealthIndicator, HealthSummary } from './health-indicator';

const meta = { title: 'Molecules/HealthIndicator', component: HealthIndicator } satisfies Meta<typeof HealthIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnTime: Story = { args: { health: 'on-time' } };
export const Late: Story = { args: { health: 'late', detail: 'seen 34 min ago' } };
export const Silent: Story = { args: { health: 'silent', detail: 'not seen for 1 h 12 min' } };
export const NotOnStation: Story = { args: { health: 'not-on-station' } };
export const Summary: Story = {
  args: { health: 'on-time' },
  render: () => (
    <HealthSummary
      counts={[
        { health: 'on-time', count: 2 },
        { health: 'late', count: 1 },
        { health: 'silent', count: 1 },
      ]}
    />
  ),
};
