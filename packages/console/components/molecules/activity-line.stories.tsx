import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ActivityLine } from './activity-line';

const NOW = new Date('2026-10-31T13:05:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const TOOL_CALL = { at: ago(2 * 60_000), kind: 'tool', tool: 'Bash', reportedAt: ago(10_000), intervalSeconds: 30 } as const;
const TRIERARCH_DOWN = { ...TOOL_CALL, reportedAt: ago(25 * 60_000) };

const meta = {
  title: 'Molecules/ActivityLine',
  component: ActivityLine,
  args: { now: NOW, testId: 'ship-activity', variant: 'row', activity: TOOL_CALL },
} satisfies Meta<typeof ActivityLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Row: Story = {};
export const RowUnknown: Story = { args: { activity: TRIERARCH_DOWN } };
export const ShipPage: Story = { args: { variant: 'full' } };
export const ShipPageUnknown: Story = { args: { variant: 'full', activity: TRIERARCH_DOWN } };
export const CrewedByHand: Story = { args: { activity: null } };
