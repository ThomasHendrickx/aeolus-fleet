import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { MACHINE_LABELS, MACHINE_VALUES, OUT_OF_CREDIT_AT } from '../../../../lib/fixtures/machines.fixtures';
import { ARGO, minutesAgo, NOW, PLANNER } from '../../../../lib/fixtures/ship-page.fixtures';
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

/** On the API key: the login after the computer, and what it spent on the key (aeolus-fleet-trierarch's api keys design, K12). */
export const OnTheApiKey: Story = {
  args: { ...RunningWithPlugin.args, login: { login: 'apiKey', spentOnKeyUsd: 12.5 } },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByTestId('crew-request-login')).toHaveTextContent('· API key');
    await expect(card.getByTestId('crew-request-spent-on-key')).toHaveTextContent('Spent on key $12.50');
  },
};
/** Moved to the key while it runs: its session keeps the subscription, its next start uses the key (K3). */
export const NextOnTheApiKey: Story = {
  args: { ...RunningWithPlugin.args, login: { login: 'subscription', next: 'apiKey' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('crew-request-login')).toHaveTextContent('· Subscription, next: API key');
  },
};
/** Its key out of credit: one note in the attention tone, since when, and that deliveries wait (K9). */
export const KeyOutOfCredit: Story = {
  args: { ...RunningWithPlugin.args, login: { login: 'apiKey', spentOnKeyUsd: 12.5, keyNotReady: { key: 'outOfCredit', at: OUT_OF_CREDIT_AT } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('API key out of credit since 14:02. Deliveries wait.');
  },
};
/** Its key refused by its vendor (K10). */
export const KeyRefused: Story = {
  args: { ...RunningWithPlugin.args, login: { login: 'apiKey', keyNotReady: { key: 'refused', at: OUT_OF_CREDIT_AT } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('API key refused since 14:02. Deliveries wait.');
  },
};
/** No API key on the computer. */
export const NoKey: Story = {
  args: { ...RunningWithPlugin.args, login: { login: 'apiKey', keyNotReady: { key: 'none' } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('No API key. Deliveries wait.');
  },
};

/** With the plugin the card links to the Usage page filtered to this ship. */
export const RunningWithUsageLink: Story = {
  args: { ...RunningWithPlugin.args, usageHref: '/usage?ship=shp_01j9k2t4qzr3a9w6m2v5n7sa01' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('crew-request-usage')).toHaveAttribute('href', '/usage?ship=shp_01j9k2t4qzr3a9w6m2v5n7sa01');
  },
};

/** Without the plugin there is no Usage link. */
export const RunningWithoutUsageLink: Story = {
  args: { ...Running.args },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('crew-request-usage')).toBeNull();
  },
};
