import { createIdGenerator, type NeedsAttentionDelivery } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { attentionReason, canResend, deliveryWithId, DISMISSED_TOAST, messagePathOf, overduePathOf, overdueReason, resentToast, undeliverableReason } from './needs-attention';

const newId = createIdGenerator();
const builder = { id: newId('ship'), name: 'builder-core' };
const tester = { id: newId('ship'), name: 'tester-01' };

function anUndeliverable(recipient: NeedsAttentionDelivery['message']['recipient']): NeedsAttentionDelivery {
  return {
    deliveryId: newId('delivery'),
    state: 'undeliverable',
    attempts: 5,
    isPushed: false,
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

describe('undeliverableReason', () => {
  it('counts the hand-overs before the refused fifth receive of a pull ship', () => {
    expect(undeliverableReason({ attempts: 5, isPushed: false })).toBe('Handed (pulled) 4 times, never acknowledged; fifth receive refused: undeliverable.');
  });

  it('counts the hand-overs of a pushed ship, never confirmed, before the refused fifth', () => {
    expect(undeliverableReason({ attempts: 5, isPushed: true })).toBe('Handed 4 times, never confirmed; fifth refused: undeliverable.');
  });
});

describe('attentionReason', () => {
  it('says why an undeliverable delivery is there, from its attempts', () => {
    expect(attentionReason({ state: 'undeliverable', attempts: 5, isPushed: true })).toBe(undeliverableReason({ attempts: 5, isPushed: true }));
  });

  it('says a delivery not handled was confirmed, and its turn died twice', () => {
    expect(attentionReason({ state: 'notHandled', attempts: 1, isPushed: true })).toBe(
      'Acknowledged, then its turn died; handed once more, and that turn died too: not handled.',
    );
  });
});

describe('overdueReason', () => {
  it('names the state it was told in and the clock that ran out', () => {
    expect(overdueReason({ state: 'handed', clock: 'notConfirmed' })).toBe('Handed, not confirmed');
    expect(overdueReason({ state: 'pending', clock: 'idle' })).toBe('Pending, session idle');
    expect(overdueReason({ state: 'received', clock: 'busy' })).toBe('Received, session busy');
  });
});

describe('overduePathOf', () => {
  it('opens the message on the page of the ship it is overdue on, in the Messages tab', () => {
    const { message } = anUndeliverable({ kind: 'ship', ship: tester });

    expect(overduePathOf({ ship: tester, message })).toBe(`/ships/${tester.id}?tab=messages&message=${message.id}`);
  });
});
