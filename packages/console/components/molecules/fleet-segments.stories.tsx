import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { FleetSegments } from './fleet-segments';

const meta = {
  title: 'Molecules/FleetSegments',
  component: FleetSegments,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  args: { active: 'ships', needsCrewCount: 3 },
} satisfies Meta<typeof FleetSegments>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ships: Story = {};
export const NeedsCrew: Story = { args: { active: 'needs-crew' } };
export const NothingNeedsCrew: Story = { args: { needsCrewCount: 0 } };
