import type { Meta, StoryObj } from '@storybook/nextjs-vite';

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

const assigned = (status: 'crewing' | 'running' | 'restarting' | 'crashed' | 'releasing') =>
  ({ kind: 'assigned', requestedAt: minutesAgo(90), trierarch: TRIERARCH, status }) as const;

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
export const Running: Story = { args: { stage: assigned('running'), isAwaitingCrew: false } };
export const Restarting: Story = { args: { stage: assigned('restarting'), statusChangedAt: minutesAgo(3), isAwaitingCrew: false } };
export const Crashed: Story = { args: { stage: assigned('crashed'), statusChangedAt: minutesAgo(3), isAwaitingCrew: false } };
export const RestartFailed: Story = { args: { ...Crashed.args, error: { action: 'restart', message: 'The server did not answer.' } } };
export const Releasing: Story = { args: { stage: assigned('releasing'), statusChangedAt: minutesAgo(1), isAwaitingCrew: false } };
export const RequestedByAnotherShip: Story = { args: { ...Running.args, requestedBy: PLANNER } };
export const ReadOnly: Story = { args: { ...Running.args, canManage: false } };
