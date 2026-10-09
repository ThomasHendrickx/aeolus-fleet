import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  dismissDeliveryInputSchema,
  dismissDeliveryOutputSchema,
  needsAttentionOutputSchema,
  resendDeliveryInputSchema,
  resendDeliveryOutputSchema,
} from './needs-attention.js';

const newId = createIdGenerator();
const builder = { id: newId('ship'), name: 'builder-core' };
const tester = { id: newId('ship'), name: 'tester-01' };
const AT = '2026-10-01T09:00:00.000Z';

describe('needsAttentionOutputSchema', () => {
  const undeliverable = {
    deliveryId: newId('delivery'),
    attempts: 5,
    since: AT,
    message: {
      id: newId('message'),
      sender: builder,
      recipient: { kind: 'ship', ship: tester },
      inReplyTo: null,
      sentAt: AT,
      contentType: 'application/json',
      isPing: false,
      payload: '{"run":"e2e","ref":"pr-320"}',
    },
  };

  it('takes undeliverable deliveries with their message, claims and since when', () => {
    expect(needsAttentionOutputSchema.parse([undeliverable])).toEqual([undeliverable]);
  });

  it('takes one addressed to a type', () => {
    const toType = { ...undeliverable, message: { ...undeliverable.message, recipient: { kind: 'type', type: 'tester' } } };

    expect(needsAttentionOutputSchema.safeParse([toType]).success).toBe(true);
  });

  it('refuses a time that is not ISO 8601', () => {
    expect(needsAttentionOutputSchema.safeParse([{ ...undeliverable, since: '1 Oct 2026' }]).success).toBe(false);
  });

  it('refuses a message that does not tell whether it is a ping', () => {
    const { id, sender, recipient, inReplyTo, sentAt, contentType, payload } = undeliverable.message;
    const message = { id, sender, recipient, inReplyTo, sentAt, contentType, payload };

    expect(needsAttentionOutputSchema.safeParse([{ ...undeliverable, message }]).success).toBe(false);
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
