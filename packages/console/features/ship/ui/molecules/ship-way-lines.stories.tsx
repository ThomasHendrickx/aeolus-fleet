import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import {
  HANDED_OVERDUE_WAY,
  MAC_MINI,
  NOTHING_WAITING_WAY,
  NOW,
  PULL_WAY,
  TRIERARCH_WAY,
  WATCHER_BUSY_WAY,
  minutesAgo,
} from '../../../../lib/fixtures/ship-page.fixtures';
import { shipWayView } from '../../services/ship-way';
import { ShipWayLines } from './ship-way-lines';

const meta = {
  title: 'Molecules/ShipWayLines',
  component: ShipWayLines,
  args: { view: shipWayView(WATCHER_BUSY_WAY, { now: NOW }), onOpenMessage: fn() },
} satisfies Meta<typeof ShipWayLines>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Crewed by hand: the plugin watcher, busy, its oldest pending past 60 min (3.4). */
export const PluginWatcherBusy: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByTestId('ship-way-line').map((line) => line.textContent)).toEqual(['Plugin watcher', expect.stringMatching(/^Busy since /)]);
    await expect(canvas.getByTestId('ship-way-oldest')).toHaveTextContent('Pending1 h ago · argo told at 60 min');
  },
};

/** The oldest of three handed and never confirmed: argo told at 10 min (3.8). Opens its message. */
export const HandedNotConfirmed: Story = {
  args: { view: shipWayView(HANDED_OVERDUE_WAY, { now: NOW }) },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /^Open the oldest message waiting/ }));
    await expect(args.onOpenMessage).toHaveBeenCalledTimes(1);
  },
};

/** Crewed by a trierarch, its oldest received while the session restarts (3.5). */
export const Trierarch: Story = { args: { view: shipWayView(TRIERARCH_WAY, { now: NOW }) } };

/** The trierarch plugin finds the trierarch's machine silent (3.1). */
export const TrierarchSilent: Story = {
  args: { view: shipWayView(TRIERARCH_WAY, { now: NOW, machines: [{ shipId: MAC_MINI.id, isSilent: true, lastSeenAt: minutesAgo(9) }] }) },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByTestId('ship-way-line')[1]).toHaveTextContent(/^Trierarch on mac-mini silent since/);
  },
};

/** Nothing waits. */
export const NothingWaiting: Story = { args: { view: shipWayView(NOTHING_WAITING_WAY, { now: NOW }) } };

/** A pull lease: no trierarch, no plugin; its oldest handed (pulled), not acknowledged (4.2, 4.4). */
export const Pull: Story = {
  args: { view: shipWayView(PULL_WAY, { now: NOW }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('ship-way-line')).toHaveTextContent('Pull: nobody wakes it');
    await expect(canvas.getByTestId('ship-way-oldest')).toHaveTextContent('Handed (pulled)');
  },
};

export const PluginWatcherBusyDark: Story = { ...PluginWatcherBusy, globals: { theme: 'dark' } };
export const HandedNotConfirmedDark: Story = { ...HandedNotConfirmed, globals: { theme: 'dark' } };
export const TrierarchSilentDark: Story = { ...TrierarchSilent, globals: { theme: 'dark' } };
export const PullDark: Story = { ...Pull, globals: { theme: 'dark' } };
export const Phone: Story = { ...HandedNotConfirmed, globals: { viewport: { value: 'mobile1' } } };
