import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  ackInputSchema,
  ackOutputSchema,
  INBOX_WAIT_MAX_SECONDS,
  inboxInputSchema,
  inboxOutputSchema,
  RECEIVE_MAX_DEFAULT,
  RECEIVE_MAX_UPPER_BOUND,
  receivedDeliverySchema,
  receiveInputSchema,
  receiveOutputSchema,
} from './delivery.js';

const newId = createIdGenerator();

describe('the receive batch size', () => {
  it('is one unless the ship asks for more', () => {
    expect(RECEIVE_MAX_DEFAULT).toBe(1);
  });

  it('is at most ten', () => {
    expect(RECEIVE_MAX_UPPER_BOUND).toBe(10);
  });
});

describe('receiveInputSchema', () => {
  it('accepts no input: the ship leaves the batch size to the default', () => {
    expect(receiveInputSchema.parse(undefined)).toBeUndefined();
    expect(receiveInputSchema.parse({})).toEqual({});
  });

  it.each([1, 5, 10])('accepts a max of %i', (max) => {
    expect(receiveInputSchema.parse({ max })).toEqual({ max });
  });

  it.each([
    ['zero', 0],
    ['eleven', 11],
    ['a fraction', 2.5],
    ['a negative number', -1],
    ['text', '3'],
  ])('rejects a max of %s', (_label, max) => {
    expect(receiveInputSchema.safeParse({ max }).success).toBe(false);
  });
});

describe('receivedDeliverySchema', () => {
  const delivery = {
    deliveryId: newId('delivery'),
    messageId: newId('message'),
    senderShipId: newId('ship'),
    senderName: 'argo',
    senderType: 'operator',
    recipient: { kind: 'ship', shipId: newId('ship') },
    payload: '{"review":"https://github.com/ThomasHendrickx/aeolus-fleet/pull/22"}',
    contentType: 'application/json',
    inReplyTo: null,
    sentAt: '2026-09-30T12:00:00.000Z',
    attempts: 1,
  };

  it("accepts a delivery to the ship, with its message and its sender's id, name and type", () => {
    expect(receivedDeliverySchema.parse(delivery)).toEqual(delivery);
  });

  it('accepts a delivery to a type, replying to a message', () => {
    const toType = { ...delivery, recipient: { kind: 'type', type: 'reviewer' }, inReplyTo: newId('message') };

    expect(receivedDeliverySchema.parse(toType)).toEqual(toType);
  });

  it.each([
    ['a delivery id of another kind', { ...delivery, deliveryId: newId('message') }],
    ['a send date that is not ISO 8601', { ...delivery, sentAt: 'yesterday' }],
    ['no attempt yet', { ...delivery, attempts: 0 }],
    ['a recipient of an unknown kind', { ...delivery, recipient: { kind: 'group', group: 'reviewers' } }],
    ['no sender name', { ...delivery, senderName: undefined }],
    ['no sender type', { ...delivery, senderType: undefined }],
  ])('rejects %s', (_label, candidate) => {
    expect(receivedDeliverySchema.safeParse(candidate).success).toBe(false);
  });
});

describe('receiveOutputSchema', () => {
  it('accepts no deliveries: the wait ended empty', () => {
    expect(receiveOutputSchema.parse({ deliveries: [] })).toEqual({ deliveries: [] });
  });
});

describe('ackInputSchema', () => {
  it('accepts a delivery id', () => {
    const deliveryId = newId('delivery');

    expect(ackInputSchema.parse({ deliveryId })).toEqual({ deliveryId });
  });

  it.each([
    ['an id of another kind', { deliveryId: newId('message') }],
    ['no delivery id', {}],
  ])('rejects %s', (_label, candidate) => {
    expect(ackInputSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('ackOutputSchema', () => {
  it('is empty: the OK is the answer', () => {
    expect(ackOutputSchema.parse({})).toEqual({});
  });
});

describe('inboxInputSchema', () => {
  it.each([undefined, {}, { waitSeconds: 0 }, { waitSeconds: INBOX_WAIT_MAX_SECONDS }])(
    'accepts %j: no wait, or up to 25 seconds while the inbox is empty',
    (input) => {
      expect(inboxInputSchema.parse(input)).toEqual(input);
    },
  );

  it.each([{ waitSeconds: -1 }, { waitSeconds: INBOX_WAIT_MAX_SECONDS + 1 }, { waitSeconds: 2.5 }])(
    'rejects %j',
    (input) => {
      expect(inboxInputSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('inboxOutputSchema', () => {
  it('answers how many deliveries wait for the crew', () => {
    expect(inboxOutputSchema.parse({ waiting: 3 })).toEqual({ waiting: 3 });
  });

  it('rejects a negative count', () => {
    expect(inboxOutputSchema.safeParse({ waiting: -1 }).success).toBe(false);
  });
});
