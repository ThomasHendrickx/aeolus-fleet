import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ALIVE_MACHINE, KEPT_SHIP_ID, MACHINE_LABELS, MACHINE_VALUES, NEW_MACHINE, NOW, SILENT_MACHINE, SPOTS } from './machines.fixtures';
import { MachineDetail } from './machine-detail';

const meta = {
  title: 'Organisms/MachineDetail',
  component: MachineDetail,
  args: { machine: ALIVE_MACHINE, state: 'ready', spots: SPOTS, location: { kind: 'DEVICE', description: 'Mac mini' }, labels: MACHINE_LABELS.chipsOf([MACHINE_VALUES.macos, MACHINE_VALUES.arm64]), now: NOW },
} satisfies Meta<typeof MachineDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alive: Story = {};
/** With fleet:manage, a kept worktree offers Delete; it names the worktree, never a path (#325). */
export const KeptWorktreeDelete: Story = {
  args: { shipNames: new Map([[KEPT_SHIP_ID, 'planner-1']]), onClearKept: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('aeolus-fleet/planner-1')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Delete the kept aeolus-fleet worktree of planner-1' }));
    await expect(args.onClearKept).toHaveBeenCalledWith({ shipId: KEPT_SHIP_ID, repository: 'aeolus-fleet', shipName: 'planner-1' });
  },
};
/** A clear request waits for the trierarch: the worktree shows Clearing, in words, and offers no Delete (decision 0032). */
export const KeptWorktreeClearing: Story = {
  args: {
    onClearKept: fn(),
    clearRequests: [{ trierarchShipId: ALIVE_MACHINE.shipId, shipId: KEPT_SHIP_ID, repository: 'aeolus-fleet' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('machine-worktree-clearing')).toHaveTextContent('Clearing');
    await expect(canvas.queryByTestId('machine-worktree-delete')).toBeNull();
  },
};
/** Without fleet:manage, kept worktrees are shown only. */
export const KeptWorktreeReadOnly: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('machine-worktree-delete')).toBeNull();
  },
};
export const NotAnswering: Story = { args: { machine: SILENT_MACHINE, spots: SPOTS.slice(0, 2), location: { kind: 'DEVICE', description: 'MacBook' } } };
export const NotStarted: Story = { args: { machine: NEW_MACHINE, spots: [], location: null, labels: [] } };
export const Loading: Story = { args: { machine: undefined, state: 'loading' } };
export const NotFound: Story = { args: { machine: undefined, state: 'not-found' } };
