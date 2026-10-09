import { createIdGenerator, type UndeliverableDelivery } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { canResend, deliveryWithId, DISMISSED_TOAST, messagePathOf, resentToast } from './needs-attention';

const newId = createIdGenerator();
const builder = { id: newId('ship'), name: 'builder-core' };
const tester = { id: newId('ship'), name: 'tester-01' };

function anUndeliverable(recipient: UndeliverableDelivery['message']['recipient']): UndeliverableDelivery {
  return {
    deliveryId: newId('delivery'),
    attempts: 5,
    since: '2026-10-01T13:12:00.000Z',
    message: {
      id: newId('message'),
      sender: builder,
      recipient,
      inReplyTo: null,
      sentAt: '2026-10-01T13:10:00.000Z',
      contentType: 'application/json',
      isPing: false,
      payload: '{"run":"e2e","ref":"pr-320"}',
    },
  };
}

describe('messagePathOf', () => {
  it("opens the message on its sender's page, in the Messages tab", () => {
    const delivery = anUndeliverable({ kind: 'ship', ship: tester });

    expect(messagePathOf(delivery)).toBe(`/ships/${builder.id}?tab=messages&message=${delivery.message.id}`);
  });
});

describe('resentToast', () => {
  it('names the ship the new message went to', () => {
    expect(resentToast(anUndeliverable({ kind: 'ship', ship: tester }))).toEqual({
      title: 'Message resent',
      description: 'A new message went to tester-01. The original is dismissed.',
    });
  });

  it('names the type for a message to any ship of a type', () => {
    expect(resentToast(anUndeliverable({ kind: 'type', type: 'tester' })).description).toBe(
      'A new message went to any ship of type tester. The original is dismissed.',
    );
  });
});

describe('DISMISSED_TOAST', () => {
  it('says the delivery stays in history', () => {
    expect(DISMISSED_TOAST).toEqual({ title: 'Delivery dismissed', description: 'It stays in the timelines as dismissed.' });
  });
});

describe('deliveryWithId', () => {
  it('finds the delivery the list still shows', () => {
    const delivery = anUndeliverable({ kind: 'ship', ship: tester });

    expect(deliveryWithId([delivery], delivery.deliveryId)).toBe(delivery);
    expect(deliveryWithId([delivery], newId('delivery'))).toBeUndefined();
    expect(deliveryWithId(undefined, delivery.deliveryId)).toBeUndefined();
  });
});

describe('canResend', () => {
  it('offers Resend for an undeliverable message', () => {
    expect(canResend(anUndeliverable({ kind: 'ship', ship: tester }))).toBe(true);
  });

  it('offers no Resend for an undeliverable ping: only Dismiss', () => {
    const ping = anUndeliverable({ kind: 'ship', ship: tester });

    expect(canResend({ ...ping, message: { ...ping.message, contentType: 'application/vnd.aeolus.ping', isPing: true } })).toBe(false);
  });
});
