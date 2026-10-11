import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { FLEET, MACHINES, NOW } from '../../../lib/fixtures/machines.fixtures';
import { MachineList } from './machine-list';

const meta = {
  title: 'Organisms/MachineList',
  component: MachineList,
  args: { connection: 'connected', machines: MACHINES, ships: FLEET, now: NOW, onRetry: () => undefined, onJoin: () => undefined },
} satisfies Meta<typeof MachineList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Machines: Story = {};
export const NoMachines: Story = { args: { machines: [] } };
export const NoMachinesReadOnly: Story = { args: { machines: [], onJoin: undefined } };
export const Loading: Story = { args: { machines: undefined } };
export const LoadFailed: Story = { args: { machines: undefined, error: 'the trierarch plugin did not answer: try again in a moment' } };
export const NotSetUp: Story = { args: { connection: 'none', machines: undefined } };
export const NotConnected: Story = { args: { connection: 'not-connected', machines: undefined } };
