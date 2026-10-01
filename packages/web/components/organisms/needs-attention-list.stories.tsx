import { idSchema, type UndeliverableDelivery } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { NeedsAttentionList } from './needs-attention-list';

const NOW = new Date('2026-09-28T14:32:00Z');
const MINUTE_MS = 60_000;

const builder = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank3k2p'), name: 'builder-core' };
const tester = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ankq8zr'), name: 'tester-01' };
const argo = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank0a90'), name: 'argo' };

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

const fromArgo: UndeliverableDelivery = {
  deliveryId: idSchema('delivery').parse('dlv_01m3tbfspe96yf1rnr4ank0002'),
  attempts: 5,
  since: ago(165),
  message: {
    id: idSchema('message').parse('msg_01m3tbfspe96yf1rnr4ank0002'),
    sender: argo,
    recipient: { kind: 'type', type: 'reviewer' },
    inReplyTo: null,
    sentAt: ago(170),
    contentType: 'text/plain',
    payload: 'Pause all reviews until 15:00.',
  },
};

const fromBuilder: UndeliverableDelivery = {
  deliveryId: idSchema('delivery').parse('dlv_01m3tbfspe96yf1rnr4ank0001'),
  attempts: 5,
  since: ago(80),
  message: {
    id: idSchema('message').parse('msg_01m3tbfspe96yf1rnr4ank0001'),
    sender: builder,
    recipient: { kind: 'ship', ship: tester },
    inReplyTo: null,
    sentAt: ago(95),
    contentType: 'application/json',
    payload: '{"run":"e2e","ref":"pr-320"}',
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

export const Empty: Story = { args: { deliveries: [] } };

export const Loading: Story = { args: { state: 'loading' } };

export const LoadFailed: Story = { args: { state: 'error' } };

/** The first row's resend is in flight: its Resend shows a spinner and its Dismiss waits. */
export const Pending: Story = { args: { pendingIds: new Set([fromArgo.deliveryId]) } };

/** One card per delivery, Dismiss and Resend full width. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
