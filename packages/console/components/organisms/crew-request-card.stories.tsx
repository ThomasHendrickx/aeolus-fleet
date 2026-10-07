import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { MACHINE_LABELS, MACHINE_VALUES } from './machines.fixtures';
import { ARGO, minutesAgo, NOW, PLANNER } from './ship-page.fixtures';
import { CrewRequestCard } from './crew-request-card';

const TRIERARCH = { ...PLANNER, name: 'trierarch-mac' };

const meta = {
  title: 'Organisms/CrewRequestCard',
  component: CrewRequestCard,
  args: {
    stage: { kind: 'none' },
    requestedBy: ARGO,
    now: NOW,
    canManage: true,
    isAwaitingCrew: true,
    onRequest: () => undefined,
    onRemove: () => undefined,
    onRelease: () => undefined,
    onRestart: () => undefined,
    onGetStartingPrompt: () => undefined,
  },
} satisfies Meta<typeof CrewRequestCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const assigned = (status: 'crewing' | 'running' | 'restarting' | 'crashed' | 'releasing', session: { attempt?: number; startedAt?: string } = {}) =>
  ({ kind: 'assigned', requestedAt: minutesAgo(90), trierarch: TRIERARCH, status, attempt: session.attempt ?? 0, startedAt: session.startedAt ?? null }) as const;

export const None: Story = {};
export const Requesting: Story = { args: { busy: 'request' } };
export const RequestFailed: Story = { args: { error: { action: 'request', message: 'The server did not answer.' } } };
export const NeedsCrew: Story = { args: { stage: { kind: 'needsCrew', requestedAt: minutesAgo(25), reason: null } } };
export const NeedsCrewWithReason: Story = { args: { stage: { kind: 'needsCrew', requestedAt: minutesAgo(25), reason: 'no trierarch has room' } } };
export const Removing: Story = { args: { ...NeedsCrew.args, busy: 'remove' } };
export const CrewedByHand: Story = {
  args: { stage: { kind: 'crewedByHand', requestedAt: minutesAgo(45), crewedBy: ARGO, since: minutesAgo(20) }, isAwaitingCrew: false },
};
export const Crewing: Story = { args: { stage: assigned('crewing'), isAwaitingCrew: false } };
export const Running: Story = { args: { stage: assigned('running', { startedAt: minutesAgo(80) }), isAwaitingCrew: false } };
export const RunningAfterRestart: Story = { args: { stage: assigned('running', { attempt: 1, startedAt: minutesAgo(12) }), isAwaitingCrew: false } };
export const Restarting: Story = { args: { stage: assigned('restarting', { attempt: 2 }), statusChangedAt: minutesAgo(3), isAwaitingCrew: false } };
export const Crashed: Story = { args: { stage: assigned('crashed', { attempt: 5 }), statusChangedAt: minutesAgo(3), isAwaitingCrew: false } };
export const RestartFailed: Story = { args: { ...Crashed.args, error: { action: 'restart', message: 'The server did not answer.' } } };
export const Releasing: Story = { args: { stage: assigned('releasing'), statusChangedAt: minutesAgo(1), isAwaitingCrew: false } };
export const RequestedByAnotherShip: Story = { args: { ...Running.args, requestedBy: PLANNER } };
export const ReadOnly: Story = { args: { ...Running.args, canManage: false } };

/** With the trierarch plugin on: settings shown, Edit offered, no starting prompt on the card. */
const ROWS = [
  { label: 'Harness', value: 'claude-code' },
  { label: 'Workspace', value: 'aeolus-fleet', meta: 'New worktree' },
  { label: 'model', value: 'claude-opus-5-5', isMono: true },
  { label: 'effort', value: 'high', isMono: true },
  { label: 'First prompt', value: '112 B' },
  { label: 'Squadron', value: null, isMono: true },
];
export const NoneWithPlugin: Story = { args: { hasTrierarchs: true } };
export const NeedsCrewWithPlugin: Story = {
  args: { stage: { kind: 'needsCrew', requestedAt: minutesAgo(25), reason: 'no trierarch with room: all 2 that fit are full' }, hasTrierarchs: true, settingsRows: ROWS, onEdit: () => undefined },
};
export const WaitingForAssignment: Story = { args: { stage: { kind: 'needsCrew', requestedAt: minutesAgo(1), reason: null }, hasTrierarchs: true, settingsRows: ROWS, onEdit: () => undefined } };
export const RunningWithPlugin: Story = { args: { ...Running.args, hasTrierarchs: true, settingsRows: ROWS, onEdit: () => undefined } };
export const CrashedWithPlugin: Story = { args: { ...Crashed.args, hasTrierarchs: true, settingsRows: ROWS, onEdit: () => undefined } };
/** A request for machines carrying os=linux and arch=arm64, which none does: it waits, and says why (canvas LbBlockNoMatch). */
export const NoMachineMatches: Story = {
  args: {
    stage: { kind: 'needsCrew', requestedAt: minutesAgo(2), reason: 'no machine matches its labels' },
    hasTrierarchs: true,
    settingsRows: ROWS,
    machineLabels: MACHINE_LABELS.chipsOf([MACHINE_VALUES.linux, MACHINE_VALUES.arm64]),
    onEdit: () => undefined,
  },
};
/** A running request on a machine carrying the labels it asked for. */
export const RunningWithMachineLabels: Story = { args: { ...RunningWithPlugin.args, machineLabels: MACHINE_LABELS.chipsOf([MACHINE_VALUES.macos, MACHINE_VALUES.arm64]) } };
