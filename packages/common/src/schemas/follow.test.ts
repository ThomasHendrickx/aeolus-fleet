import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { FOLLOW_MAX_DEFAULT, FOLLOW_MAX_LIMIT, followFleetInputSchema, followFleetOutputSchema } from './follow.js';

const newId = createIdGenerator();

describe('followFleetInputSchema', () => {
  it.each([undefined, {}, { afterSeq: 0 }, { afterSeq: 42, max: 1, waitSeconds: 25 }, { max: 100, waitSeconds: 0 }])(
    'accepts %j: where to follow from, how many at most, how long to wait',
    (input) => {
      expect(followFleetInputSchema.safeParse(input).success).toBe(true);
    },
  );

  it.each([
    ['a negative position', { afterSeq: -1 }],
    ['a position that is not whole', { afterSeq: 1.5 }],
    ['no event at most', { max: 0 }],
    ['more than 100 at most', { max: 101 }],
    ['a wait over 25 seconds', { waitSeconds: 26 }],
  ])('rejects %s', (_label, input) => {
    expect(followFleetInputSchema.safeParse(input).success).toBe(false);
  });

  it('answers 100 events at most unless told fewer', () => {
    expect([FOLLOW_MAX_DEFAULT, FOLLOW_MAX_LIMIT]).toEqual([100, 100]);
  });
});

describe('followFleetOutputSchema', () => {
  const event = {
    seq: 7,
    id: newId('event'),
    type: 'ShipCommissioned',
    occurredAt: '2026-10-02T19:00:00.000Z',
    actorShipId: newId('ship'),
    shipId: newId('ship'),
    messageId: null,
    deliveryId: null,
  };

  it('answers the events and the number to follow from next', () => {
    const output = { events: [event], lastSeq: 7 };

    expect(followFleetOutputSchema.parse(output)).toEqual(output);
  });

  it('answers no events and the current number to start from', () => {
    expect(followFleetOutputSchema.parse({ events: [], lastSeq: 0 })).toEqual({ events: [], lastSeq: 0 });
  });
});
