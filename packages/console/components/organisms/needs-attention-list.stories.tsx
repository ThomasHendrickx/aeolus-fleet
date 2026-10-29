import { idSchema, type NeedsAttentionDelivery } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { NeedsAttentionList } from './needs-attention-list';

const NOW = new Date('2026-09-28T14:32:00Z');
const MINUTE_MS = 60_000;

const builder = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank3k2p'), name: 'builder-core' };
const tester = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ankq8zr'), name: 'tester-01' };
const argo = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank0a90'), name: 'argo' };

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

const fromArgo: NeedsAttentionDelivery = {
  deliveryId: idSchema('delivery').parse('dlv_01m3tbfspe96yf1rnr4ank0002'),
  state: 'undeliverable',
  attempts: 5,
  isPushed: false,
  since: ago(165),
  reason: null,
  ship: tester,
  message: {
    id: idSchema('message').parse('msg_01m3tbfspe96yf1rnr4ank0002'),
    sender: argo,
    recipient: { kind: 'type', type: 'reviewer' },
    inReplyTo: null,
    sentAt: ago(170),
    contentType: 'text/plain',
    isPing: false,
    payload: 'Pause all reviews until 15:00.',
    isPayloadUnreadable: false,
  },
};

const fromBuilder: NeedsAttentionDelivery = {
  deliveryId: idSchema('delivery').parse('dlv_01m3tbfspe96yf1rnr4ank0001'),
  state: 'undeliverable',
  attempts: 5,
  isPushed: false,
  since: ago(80),
  reason: null,
  ship: tester,
  message: {
    id: idSchema('message').parse('msg_01m3tbfspe96yf1rnr4ank0001'),
    sender: builder,
    recipient: { kind: 'ship', ship: tester },
    inReplyTo: null,
    sentAt: ago(95),
    contentType: 'application/json',
    isPing: false,
    payload: '{"run":"e2e","ref":"pr-320"}',
    isPayloadUnreadable: false,
  },
};

/** Confirmed by its ship's hook, then its turn died twice. */
const notHandled: NeedsAttentionDelivery = {
  deliveryId: idSchema('delivery').parse('dlv_01m3tbfspe96yf1rnr4ank0003'),
  state: 'notHandled',
  attempts: 1,
  isPushed: true,
  since: ago(30),
  reason: null,
  ship: tester,
  message: {
    id: idSchema('message').parse('msg_01m3tbfspe96yf1rnr4ank0003'),
    sender: builder,
    recipient: { kind: 'ship', ship: tester },
    inReplyTo: null,
    sentAt: ago(45),
    contentType: 'text/plain',
    isPing: false,
    payload: 'Rebase pr-320 on main and run the suite.',
    isPayloadUnreadable: false,
  },
};

const meta = {
  title: 'Organisms/NeedsAttentionList',
  component: NeedsAttentionList,
  args: {
    deliveries: [fromArgo, fromBuilder],
    state: 'ready',
    onRetry: fn(),
    onResend: fn(),
    onDismiss: fn(),
    onOpen: fn(),
    pendingIds: new Set(),
    now: NOW,
  },
} satisfies Meta<typeof NeedsAttentionList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Oldest first: one from argo to a type, one between two ships. */
export const Default: Story = {};

/** An undeliverable ping offers only Dismiss: a fresh ping goes through Ping. */
export const UndeliverablePing: Story = {
  args: {
    deliveries: [
      {
        ...fromBuilder,
        message: { ...fromBuilder.message, sender: argo, contentType: 'application/vnd.aeolus.ping', isPing: true, payload: 'Ping from argo: answer with pong(deliveryId).' },
      },
    ],
  },
};

/** Not handled sits beside the undeliverable ones, by since when, with the same Resend and Dismiss. */
export const NotHandled: Story = {
  args: { deliveries: [fromArgo, fromBuilder, notHandled] },
  play: async ({ canvas }) => {
    // The table and the phone cards both hold the row; one of them shows.
    await expect(canvas.getAllByText('Not handled')[0]).toBeInTheDocument();
    await expect(
      canvas.getAllByText('Acknowledged, then its turn died; handed once more, and that turn died too: not handled.', { exact: false })[0],
    ).toBeInTheDocument();
  },
};

/** A pushed ship's computer side handed it four times, never confirmed: the fifth hand-over was refused (3.18). */
export const UndeliverablePushed: Story = {
  args: { deliveries: [{ ...fromBuilder, isPushed: true }] },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('Handed 4 times, never confirmed; fifth refused: undeliverable.', { exact: false })[0]).toBeInTheDocument();
  },
};
export const UndeliverablePushedDark: Story = { ...UndeliverablePushed, globals: { theme: 'dark' } };

export const Empty: Story = { args: { deliveries: [] } };

export const Loading: Story = { args: { state: 'loading' } };

export const LoadFailed: Story = { args: { state: 'error' } };

/** The first row's resend is in flight: its Resend shows a spinner and its Dismiss waits. */
export const Pending: Story = { args: { pendingIds: new Set([fromArgo.deliveryId]) } };

/** One card per delivery, Dismiss and Resend full width. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** A viewer session (decision 0022): the deliveries, read-only, with no Resend or Dismiss. */
export const ReadOnly: Story = { args: { onResend: undefined, onDismiss: undefined } };

/** Not handled with the reason its crew gave, shown with the entry (#847). */
export const NotHandledWithItsReason: Story = {
  args: { deliveries: [{ ...notHandled, reason: 'the turn it was handed once more to died too' }] },
  play: async ({ canvas }) => {
    // The table and the phone cards both hold the row; one of them shows.
    await expect(canvas.getAllByText('Its crew said: the turn it was handed once more to died too.', { exact: false })[0]).toBeInTheDocument();
  },
};
