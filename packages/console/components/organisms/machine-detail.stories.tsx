import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ALIVE_MACHINE, NEW_MACHINE, NOW, SILENT_MACHINE, SPOTS } from './machines.fixtures';
import { MachineDetail } from './machine-detail';

const meta = {
  title: 'Organisms/MachineDetail',
  component: MachineDetail,
  args: { machine: ALIVE_MACHINE, state: 'ready', spots: SPOTS, location: { kind: 'DEVICE', description: 'Mac mini' }, now: NOW },
} satisfies Meta<typeof MachineDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alive: Story = {};
export const NotAnswering: Story = { args: { machine: SILENT_MACHINE, spots: SPOTS.slice(0, 2), location: { kind: 'DEVICE', description: 'MacBook' } } };
export const NotStarted: Story = { args: { machine: NEW_MACHINE, spots: [], location: null } };
export const Loading: Story = { args: { machine: undefined, state: 'loading' } };
export const NotFound: Story = { args: { machine: undefined, state: 'not-found' } };
