import { idSchema, type OverdueDelivery } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { OverdueDeliveries } from './overdue-deliveries';

const NOW = new Date('2026-10-14T09:00:00Z');
const MINUTE_MS = 60_000;

const builder = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank3k2p'), name: 'builder-core' };
const reviewer = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank3k3q'), name: 'reviewer-01' };
const planner = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank3k4r'), name: 'planner' };

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

function overdue(suffix: string, delivery: Pick<OverdueDelivery, 'ship' | 'state' | 'clock' | 'minutes' | 'toldAt'> & { payload: string }): OverdueDelivery {
  const { payload, ...told } = delivery;
  return {
    deliveryId: idSchema('delivery').parse(`dlv_01m3tbfspe96yf1rnr4ank00${suffix}`),
    ...told,
    message: {
      id: idSchema('message').parse(`msg_01m3tbfspe96yf1rnr4ank00${suffix}`),
      sender: planner,
      recipient: { kind: 'ship', ship: delivery.ship },
      inReplyTo: null,
      sentAt: ago(delivery.minutes + 5),
      contentType: 'text/plain',
      isPing: false,
      payload,
    },
  };
}

/** Handed and never confirmed: argo told at 10 min (3.8). */
const notConfirmed = overdue('21', { ship: reviewer, state: 'handed', clock: 'notConfirmed', minutes: 10, toldAt: ago(2), payload: 'Review PR 48' });
/** Pending while the session is busy: argo told at 60 min (3.4). */
const busy = overdue('22', { ship: builder, state: 'pending', clock: 'busy', minutes: 60, toldAt: ago(1), payload: 'Build 0.26.0' });

const meta = {
  title: 'Organisms/OverdueDeliveries',
  component: OverdueDeliveries,
  args: { deliveries: [notConfirmed, busy], onOpen: fn(), now: NOW },
} satisfies Meta<typeof OverdueDeliveries>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Oldest told first, each with its ship, its state and clock, and when argo was told. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const rows = canvas.getAllByTestId('overdue-row');
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent('Handed, not confirmed');
    await expect(rows[0]).toHaveTextContent('argo told at 10 min · 2 min ago');
    await expect(rows[1]).toHaveTextContent('Pending, session busy');
  },
};

/** Open goes to the message, the one thing to do here: it clears by itself. */
export const Opens: Story = {
  args: { deliveries: [notConfirmed] },
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getAllByRole('button')).toHaveLength(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Open the message overdue on reviewer-01' }));
    await expect(args.onOpen).toHaveBeenCalledWith(notConfirmed);
  },
};

export const Dark: Story = { ...Default, globals: { theme: 'dark' } };
export const Phone: Story = { ...Default, globals: { viewport: { value: 'mobile1' } } };
