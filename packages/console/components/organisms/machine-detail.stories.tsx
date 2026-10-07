import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ALIVE_MACHINE, MACHINE_LABELS, MACHINE_VALUES, NEW_MACHINE, NOW, SILENT_MACHINE, SPOTS } from './machines.fixtures';
import { MachineDetail } from './machine-detail';

const meta = {
  title: 'Organisms/MachineDetail',
  component: MachineDetail,
  args: { machine: ALIVE_MACHINE, state: 'ready', spots: SPOTS, location: { kind: 'DEVICE', description: 'Mac mini' }, labels: MACHINE_LABELS.chipsOf([MACHINE_VALUES.macos, MACHINE_VALUES.arm64]), now: NOW },
} satisfies Meta<typeof MachineDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alive: Story = {};
export const NotAnswering: Story = { args: { machine: SILENT_MACHINE, spots: SPOTS.slice(0, 2), location: { kind: 'DEVICE', description: 'MacBook' } } };
export const NotStarted: Story = { args: { machine: NEW_MACHINE, spots: [], location: null, labels: [] } };
export const Loading: Story = { args: { machine: undefined, state: 'loading' } };
export const NotFound: Story = { args: { machine: undefined, state: 'not-found' } };
