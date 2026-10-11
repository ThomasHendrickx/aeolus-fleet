import { idSchema } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import type { Spot } from '../../../lib/machines';
import { CapacityBar } from './capacity-bar';

const shipId = (suffix: string) => idSchema('ship').parse(`shp_01j9k2t4qzr3a9w6m2v5n7${suffix}`);

const SPOTS: Spot[] = [
  { shipId: shipId('sp01'), name: 'aeolus-fleet', status: 'running', attempt: 0, startedAt: null },
  { shipId: shipId('sp02'), name: 'website-editor', status: 'running', attempt: 0, startedAt: null },
  { shipId: shipId('sp03'), name: 'docs-writer', status: 'crashed', attempt: 0, startedAt: null },
  { shipId: shipId('sp04'), name: 'scout-1', status: 'crewing', attempt: 0, startedAt: null },
];

const meta = {
  title: 'Molecules/CapacityBar',
  component: CapacityBar,
  args: { spots: SPOTS, caps: { ships: 6 } },
} satisfies Meta<typeof CapacityBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRoom: Story = {};
export const Full: Story = { args: { caps: { ships: 4 } } };
export const NothingRunning: Story = { args: { spots: [], caps: { ships: 3 } } };
export const Unknown: Story = { args: { caps: undefined, unknownText: 'Unknown since 10:40' } };
