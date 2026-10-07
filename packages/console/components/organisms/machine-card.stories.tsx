import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

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

/** A flag its trierarch reports as risky is marked; the others show plainly. */
export const RiskyFlag: Story = {
  play: async ({ canvasElement }) => {
    const risky = within(canvasElement).getAllByTestId('machine-risky-flag');
    await expect(risky.map((flag) => flag.textContent)).toEqual(['--dangerously-skip-permissions (risky)']);
  },
};
export const NotAnswering: Story = { args: { machine: SILENT_MACHINE, spots: SPOTS.slice(0, 2), location: { kind: 'DEVICE', description: 'MacBook' } } };
export const NotStarted: Story = { args: { machine: NEW_MACHINE, spots: [], location: null } };
