import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  dismissDeliveryInputSchema,
  dismissDeliveryOutputSchema,
  needsAttentionInputSchema,
  needsAttentionOutputSchema,
  resendDeliveryInputSchema,
  resendDeliveryOutputSchema,
} from './needs-attention.js';

const newId = createIdGenerator();
const builder = { id: newId('ship'), name: 'builder-core' };
const tester = { id: newId('ship'), name: 'tester-01' };
const AT = '2026-10-01T09:00:00.000Z';

/** A last page of Needs attention holding the deliveries. */
const lastPage = (...items: unknown[]) => ({ items, nextCursor: null });

describe('needsAttentionInputSchema', () => {
  it("takes nothing, or a ship for its page, and the cursor and size of a page", () => {
    const input = { shipId: newId('ship'), cursor: newId('delivery'), limit: 20 };

    expect([needsAttentionInputSchema.parse({}), needsAttentionInputSchema.parse(input)]).toEqual([{}, input]);
  });

  it('takes the state to list, undeliverable or not handled, and no other', () => {
    expect([needsAttentionInputSchema.safeParse({ state: 'notHandled' }).success, needsAttentionInputSchema.safeParse({ state: 'pending' }).success]).toEqual([true, false]);
  });

  it('refuses a cursor that names no delivery', () => {
    expect(needsAttentionInputSchema.safeParse({ cursor: newId('message') }).success).toBe(false);
  });
});

describe('needsAttentionOutputSchema', () => {
  const undeliverable = {
    deliveryId: newId('delivery'),
    state: 'undeliverable',
    attempts: 5,
    isPushed: false,
    since: AT,
    reason: null,
    ship: tester,
    message: {
      id: newId('message'),
      sender: builder,
      recipient: { kind: 'ship', ship: tester },
      inReplyTo: null,
      sentAt: AT,
      contentType: 'application/json',
      isPing: false,
      payload: '{"run":"e2e","ref":"pr-320"}',
      isPayloadUnreadable: false,
    },
  };

  it('takes undeliverable deliveries with their message, claims and since when', () => {
    expect(needsAttentionOutputSchema.parse(lastPage(undeliverable))).toEqual(lastPage(undeliverable));
  });

  it('refuses an entry without the ship that held it', () => {
    expect(needsAttentionOutputSchema.safeParse(lastPage({ ...undeliverable, ship: undefined })).success).toBe(false);
  });

  it('takes one addressed to a type', () => {
    const toType = { ...undeliverable, message: { ...undeliverable.message, recipient: { kind: 'type', type: 'tester' } } };

    expect(needsAttentionOutputSchema.safeParse(lastPage(toType)).success).toBe(true);
  });

  it('takes one a pushed crew handed over, told by its hand-over numbers', () => {
    const pushed = { ...undeliverable, isPushed: true };

    expect(needsAttentionOutputSchema.parse(lastPage(pushed))).toEqual(lastPage(pushed));
  });

  it('takes a delivery not handled', () => {
    const notHandled = { ...undeliverable, state: 'notHandled', attempts: 1 };

    expect(needsAttentionOutputSchema.parse(lastPage(notHandled))).toEqual(lastPage(notHandled));
  });

  it('takes a delivery not handled with the reason its crew gave (#847)', () => {
    const notHandled = { ...undeliverable, state: 'notHandled', attempts: 1, reason: 'the turn it was handed once more to died too' };

    expect(needsAttentionOutputSchema.parse(lastPage(notHandled))).toEqual(lastPage(notHandled));
  });

  it('refuses an entry that does not say its reason, or that it has none (#847)', () => {
    expect(needsAttentionOutputSchema.safeParse(lastPage({ ...undeliverable, reason: undefined })).success).toBe(false);
  });

  it('refuses a delivery in any other state', () => {
    expect(needsAttentionOutputSchema.safeParse(lastPage({ ...undeliverable, state: 'acknowledged' })).success).toBe(false);
    expect(needsAttentionOutputSchema.safeParse(lastPage({ ...undeliverable, state: undefined })).success).toBe(false);
  });

  it('refuses a time that is not ISO 8601', () => {
    expect(needsAttentionOutputSchema.safeParse(lastPage({ ...undeliverable, since: '1 Oct 2026' })).success).toBe(false);
  });

  it('refuses a message that does not tell whether it is a ping', () => {
    const { id, sender, recipient, inReplyTo, sentAt, contentType, payload } = undeliverable.message;
    const message = { id, sender, recipient, inReplyTo, sentAt, contentType, payload };

    expect(needsAttentionOutputSchema.safeParse(lastPage({ ...undeliverable, message })).success).toBe(false);
  });
});

describe('dismissDeliveryInputSchema', () => {
  it('takes a delivery id', () => {
    const input = { deliveryId: newId('delivery') };

    expect(dismissDeliveryInputSchema.parse(input)).toEqual(input);
  });

  it('refuses an id of another kind', () => {
    expect(dismissDeliveryInputSchema.safeParse({ deliveryId: newId('message') }).success).toBe(false);
  });
});

describe('dismissDeliveryOutputSchema', () => {
  it('answers nothing', () => {
    expect(dismissDeliveryOutputSchema.safeParse({}).success).toBe(true);
    expect(dismissDeliveryOutputSchema.safeParse({ deliveryId: newId('delivery') }).success).toBe(false);
  });
});

describe('resendDeliveryInputSchema', () => {
  it('takes a delivery id', () => {
    const input = { deliveryId: newId('delivery') };

    expect(resendDeliveryInputSchema.parse(input)).toEqual(input);
  });

  it('refuses an id of another kind', () => {
    expect(resendDeliveryInputSchema.safeParse({ deliveryId: newId('ship') }).success).toBe(false);
  });
});

describe('resendDeliveryOutputSchema', () => {
  it('answers the new message id', () => {
    const output = { messageId: newId('message') };

    expect(resendDeliveryOutputSchema.parse(output)).toEqual(output);
  });
});
