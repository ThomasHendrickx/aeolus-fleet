import { idSchema, type NoShipCanTakeDelivery } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { NoShipCanTake } from './no-ship-can-take';

const NOW = new Date('2026-10-14T09:00:00Z');
const MINUTE_MS = 60_000;

const builder = {
  id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank3k2p'),
  name: 'builder-core',
};
const argo = {
  id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank0a90'),
  name: 'argo',
};

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

const toPlanner: NoShipCanTakeDelivery = {
  deliveryId: idSchema('delivery').parse('dlv_01m3tbfspe96yf1rnr4ank0011'),
  type: 'planner',
  message: {
    id: idSchema('message').parse('msg_01m3tbfspe96yf1rnr4ank0011'),
    sender: builder,
    recipient: { kind: 'type', type: 'planner' },
    inReplyTo: null,
    sentAt: ago(190),
    contentType: 'text/plain',
    isPing: false,
    payload: 'Plan the release of 0.25.0',
  },
};

const toMapper: NoShipCanTakeDelivery = {
  deliveryId: idSchema('delivery').parse('dlv_01m3tbfspe96yf1rnr4ank0012'),
  type: 'mapper',
  message: {
    id: idSchema('message').parse('msg_01m3tbfspe96yf1rnr4ank0012'),
    sender: argo,
    recipient: { kind: 'type', type: 'mapper' },
    inReplyTo: null,
    sentAt: ago(12),
    contentType: 'application/json',
    isPing: false,
    payload: '{"harbour":"pagasae"}',
  },
};

const meta = {
  title: 'Organisms/NoShipCanTake',
  component: NoShipCanTake,
  args: { deliveries: [toPlanner, toMapper], onOpen: fn(), now: NOW },
} satisfies Meta<typeof NoShipCanTake>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two deliveries no ship can take, oldest sent first, each with its type and how long it waits. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const rows = canvas.getAllByTestId('no-ship-can-take-row');
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent('planner');
    await expect(rows[0]).toHaveTextContent('waiting 3 h 10 min');
  },
};

/** Open goes to the message, the one thing to do here. */
export const Opens: Story = {
  args: { deliveries: [toPlanner] },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Open the message from builder-core to any ship of type planner',
      }),
    );
    await expect(args.onOpen).toHaveBeenCalledWith(toPlanner);
  },
};

/** No action beyond Open: the operator commissions a ship of the type, and the row clears by itself. */
export const OffersNoAction: Story = {
  args: { deliveries: [toMapper] },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('button')).toHaveLength(1);
  },
};
