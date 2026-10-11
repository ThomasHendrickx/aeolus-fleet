import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { ALIVE_MACHINE, NEW_MACHINE, NOW, SILENT_MACHINE, SPOTS } from '../../../lib/fixtures/machines.fixtures';
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
/** Each harness with the version its trierarch detected and when its models were last confirmed (#365). */
export const DetectedVersions: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByText('2.1.293 · models confirmed 3 h ago')).toBeVisible();
    await expect(card.getByText('0.160.1 · no model confirmed')).toBeVisible();
  },
};
export const NotAnswering: Story = { args: { machine: SILENT_MACHINE, spots: SPOTS.slice(0, 2), location: { kind: 'DEVICE', description: 'MacBook' } } };
export const NotStarted: Story = { args: { machine: NEW_MACHINE, spots: [], location: null } };
