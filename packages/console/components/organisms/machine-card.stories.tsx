import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ALIVE_MACHINE, NEW_MACHINE, NOW, SILENT_MACHINE, SPOTS } from './machines.fixtures';
import { MachineCard } from './machine-card';

const meta = {
  title: 'Organisms/MachineCard',
  component: MachineCard,
  args: { machine: ALIVE_MACHINE, spots: SPOTS, location: { kind: 'DEVICE', description: 'Mac mini' }, now: NOW },
} satisfies Meta<typeof MachineCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alive: Story = {};
export const NotAnswering: Story = { args: { machine: SILENT_MACHINE, spots: SPOTS.slice(0, 2), location: { kind: 'DEVICE', description: 'MacBook' } } };
export const NotStarted: Story = { args: { machine: NEW_MACHINE, spots: [], location: null } };
