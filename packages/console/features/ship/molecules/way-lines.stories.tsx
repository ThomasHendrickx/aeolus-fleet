import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { WayLines } from './way-lines';

const meta = {
  title: 'Molecules/WayLines',
  component: WayLines,
  args: { status: 'pending', lines: [{ icon: 'fleet', tone: 'waiting', text: 'Fleet · Just now' }] },
} satisfies Meta<typeof WayLines>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};
export const PendingSessionBusy: Story = {
  args: {
    lines: [
      { icon: 'fleet', tone: 'waiting', text: 'Fleet · 23 min ago' },
      { icon: 'busy', tone: 'active', text: 'Session busy since 09:40' },
    ],
  },
};
export const PendingTrierarchSilent: Story = {
  args: {
    lines: [
      { icon: 'fleet', tone: 'waiting', text: 'Fleet · 7 min ago' },
      { icon: 'silent', tone: 'attention', text: 'Trierarch on mac-mini silent since 10:02' },
    ],
  },
};
export const ReceivedByTrierarch: Story = {
  args: {
    status: 'received',
    lines: [
      { icon: 'computer', tone: 'waiting', text: 'Trierarch on mac-mini · 3 min ago' },
      { icon: 'restart', tone: 'waiting', text: 'Session restarting (restart 2)' },
    ],
  },
};
export const ReceivedByPluginWatcher: Story = {
  args: { status: 'received', lines: [{ icon: 'watcher', tone: 'waiting', text: 'Plugin watcher · 3 min ago' }] },
};
export const HandedNotConfirmed: Story = {
  args: {
    status: 'handedPushed',
    lines: [
      { icon: 'agent', tone: 'waiting', text: 'Agent · 12 min ago · not confirmed · attempt 2 of 5' },
      { icon: 'clock', tone: 'attention', text: 'argo told at 10 min' },
    ],
  },
};
export const HandedPulled: Story = {
  args: { status: 'handed', lines: [{ icon: 'agent', tone: 'waiting', text: 'Agent (pulled) · 3 h ago · not acknowledged · handed (pulled) 2 times' }] },
};
export const HandledUnknown: Story = {
  args: {
    status: 'acknowledged',
    lines: [
      { icon: 'agent', tone: 'neutral', text: 'Agent · 20 min ago' },
      { icon: 'unknown', tone: 'waiting', text: 'Handled unknown: lease ended' },
    ],
  },
};
export const NotReportedPullShip: Story = {
  args: {
    status: 'acknowledged',
    lines: [
      { icon: 'agent', tone: 'neutral', text: 'Agent · 4 min ago' },
      { icon: 'unknown', tone: 'neutral', text: 'Handled: not reported (pull ship)' },
    ],
  },
};
export const Handled: Story = { args: { status: 'handled', lines: [{ icon: 'time', tone: 'neutral', text: '6 min ago' }] } };
export const NotHandled: Story = {
  args: {
    status: 'notHandled',
    lines: [
      { icon: 'time', tone: 'neutral', text: '5 min ago' },
      { icon: 'died', tone: 'attention', text: 'Session died twice · argo told 10:40' },
    ],
  },
};
export const PingWaiting: Story = {
  args: { status: 'handedPushed', lines: [{ icon: 'ping', tone: 'waiting', text: 'Pinged 3 min ago · handed 1 min ago · no answer yet' }] },
};
export const PingAnswered: Story = {
  args: { status: 'acknowledged', lines: [{ icon: 'ping', tone: 'neutral', text: 'Answered ping in 4 s after hand-over' }] },
};
export const HandedNotConfirmedDark: Story = { ...HandedNotConfirmed, globals: { theme: 'dark' } };
export const NotHandledDark: Story = { ...NotHandled, globals: { theme: 'dark' } };
export const PendingTrierarchSilentDark: Story = { ...PendingTrierarchSilent, globals: { theme: 'dark' } };
export const ReceivedByTrierarchDark: Story = { ...ReceivedByTrierarch, globals: { theme: 'dark' } };
