import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  ackInputSchema,
  ackOutputSchema,
  deliveryInputSchema,
  deliveryOutputSchema,
  handedInputSchema,
  handedOutputSchema,
  handledInputSchema,
  handledOutputSchema,
  INBOX_WAIT_MAX_SECONDS,
  inboxInputSchema,
  inboxOutputSchema,
  NOT_HANDLED_REASON_MAX_LENGTH,
  notHandledInputSchema,
  notHandledOutputSchema,
  pushReceiveOutputSchema,
  pushReceiveInputSchema,
  pushReceivedDeliverySchema,
  RECEIVE_MAX_DEFAULT,
  RECEIVE_MAX_UPPER_BOUND,
  receivedDeliverySchema,
  receiveInputSchema,
  receiveOutputSchema,
  receiveReplyInputSchema,
  sentMessageInputSchema,
  sentMessageOutputSchema,
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

describe('receiveReplyInputSchema', () => {
  it('takes the id of the message whose reply to receive', () => {
    const input = { messageId: newId('message') };

    expect(receiveReplyInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['no message id', {}],
    ['a delivery id', { messageId: newId('delivery') }],
    ['no input', undefined],
  ])('refuses %s', (_label, input) => {
    expect(receiveReplyInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('sentMessageInputSchema', () => {
  it('takes the id of a message the caller sent', () => {
    const input = { messageId: newId('message') };

    expect(sentMessageInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['no message id', {}],
    ['a delivery id', { messageId: newId('delivery') }],
  ])('refuses %s', (_label, input) => {
    expect(sentMessageInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('sentMessageOutputSchema', () => {
  it('answers the message, its recipient by name or type, and its delivery with its state and since when, and no payload', () => {
    const answer = {
      messageId: newId('message'),
      sentAt: '2026-10-18T12:00:00.000Z',
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'scout' } },
      delivery: { deliveryId: newId('delivery'), state: 'handed', since: '2026-10-18T12:00:05.000Z' },
    };

    expect(sentMessageOutputSchema.parse(answer)).toEqual(answer);
    expect(sentMessageOutputSchema.parse({ ...answer, recipient: { kind: 'type', type: 'reviewer' } }).recipient).toEqual({ kind: 'type', type: 'reviewer' });
  });

  it('refuses a delivery state it does not know', () => {
    const answer = {
      messageId: newId('message'),
      sentAt: '2026-10-18T12:00:00.000Z',
      recipient: { kind: 'type', type: 'reviewer' },
      delivery: { deliveryId: newId('delivery'), state: 'lost', since: '2026-10-18T12:00:05.000Z' },
    };

    expect(sentMessageOutputSchema.safeParse(answer).success).toBe(false);
  });
});

describe('deliveryInputSchema', () => {
  it('takes the id of a delivery the crew holds', () => {
    const input = { deliveryId: newId('delivery') };

    expect(deliveryInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['no delivery id', {}],
    ['a message id', { deliveryId: newId('message') }],
  ])('refuses %s', (_label, input) => {
    expect(deliveryInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('deliveryOutputSchema', () => {
  const reread = {
    deliveryId: newId('delivery'),
    messageId: newId('message'),
    senderShipId: newId('ship'),
    senderName: 'lookout',
    senderType: 'watcher',
    recipient: { kind: 'ship', shipId: newId('ship') },
    payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
    contentType: 'text/markdown',
    model: 'claude-opus-5-5',
    inReplyTo: newId('message'),
    sentAt: '2026-10-21T12:01:00.000Z',
    attempts: 1,
    isForced: false,
    meetingId: null,
    state: 'acknowledged',
  };

  it('answers the delivery whole, as receive hands one, with its state', () => {
    expect(deliveryOutputSchema.parse(reread)).toEqual(reread);
  });

  it('answers attempts 0 as stored, for a delivery a push receive took with no attempt counted (#1106)', () => {
    const pushed = { ...reread, attempts: 0 };

    expect(deliveryOutputSchema.parse(pushed)).toEqual(pushed);
  });

  it.each([
    ['no state', { ...reread, state: undefined }],
    ['a state it does not know', { ...reread, state: 'lost' }],
    ['no payload', { ...reread, payload: undefined }],
    ['negative attempts', { ...reread, attempts: -1 }],
  ])('rejects %s', (_label, candidate) => {
    expect(deliveryOutputSchema.safeParse(candidate).success).toBe(false);
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
    model: 'claude-opus-5-5',
    inReplyTo: null,
    sentAt: '2026-09-30T12:00:00.000Z',
    attempts: 1,
    isForced: false,
    meetingId: null,
  };

  it("accepts a delivery to the ship, with its message and its sender's id, name and type", () => {
    expect(receivedDeliverySchema.parse(delivery)).toEqual(delivery);
  });

  it('accepts a delivery from argo, which states no model', () => {
    const fromArgo = { ...delivery, model: null };

    expect(receivedDeliverySchema.parse(fromArgo)).toEqual(fromArgo);
  });

  it('accepts a delivery to a type, replying to a message', () => {
    const toType = { ...delivery, recipient: { kind: 'type', type: 'reviewer' }, inReplyTo: newId('message') };

    expect(receivedDeliverySchema.parse(toType)).toEqual(toType);
  });

  it('accepts a delivery of a meeting, which names it (decision 0061)', () => {
    const ofMeeting = { ...delivery, meetingId: newId('meeting') };

    expect(receivedDeliverySchema.parse(ofMeeting)).toEqual(ofMeeting);
  });

  it('accepts a forced delivery, which says so (decision 0040)', () => {
    const forced = { ...delivery, isForced: true };

    expect(receivedDeliverySchema.parse(forced)).toEqual(forced);
  });

  it.each([
    ['a delivery id of another kind', { ...delivery, deliveryId: newId('message') }],
    ['a send date that is not ISO 8601', { ...delivery, sentAt: 'yesterday' }],
    ['no attempt yet', { ...delivery, attempts: 0 }],
    ['a recipient of an unknown kind', { ...delivery, recipient: { kind: 'group', group: 'reviewers' } }],
    ['no sender name', { ...delivery, senderName: undefined }],
    ['no sender type', { ...delivery, senderType: undefined }],
    ['no word on whether it was forced', { ...delivery, isForced: undefined }],
    ['no word on its meeting', { ...delivery, meetingId: undefined }],
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

  it.each([{ knownWaiting: 0 }, { waitSeconds: 25, knownWaiting: 3 }])('accepts %j: the count the crew knows, waiting while it is still that', (input) => {
    expect(inboxInputSchema.parse(input)).toEqual(input);
  });

  it.each([{ waitSeconds: -1 }, { waitSeconds: INBOX_WAIT_MAX_SECONDS + 1 }, { waitSeconds: 2.5 }, { knownWaiting: -1 }, { knownWaiting: 1.5 }])(
    'rejects %j',
    (input) => {
      expect(inboxInputSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('inboxOutputSchema', () => {
  it('answers how many deliveries wait for the crew, and how many of them are forced and not handed over yet', () => {
    expect(inboxOutputSchema.parse({ waiting: 3, forced: 1 })).toEqual({ waiting: 3, forced: 1 });
  });

  it.each([
    ['a negative count', { waiting: -1, forced: 0 }],
    ['a negative forced count', { waiting: 1, forced: -1 }],
    ['no forced count', { waiting: 1 }],
  ])('rejects %s', (_label, candidate) => {
    expect(inboxOutputSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('pushReceivedDeliverySchema', () => {
  const delivery = {
    deliveryId: newId('delivery'),
    messageId: newId('message'),
    senderShipId: newId('ship'),
    senderName: 'argo',
    senderType: 'operator',
    recipient: { kind: 'ship', shipId: newId('ship') },
    payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/22',
    contentType: 'text/plain',
    model: null,
    inReplyTo: null,
    sentAt: '2026-10-12T12:00:00.000Z',
    attempts: 0,
    isForced: false,
    meetingId: null,
    state: 'received',
    handOverNumber: null,
  };

  it('accepts a delivery received and not yet handed: no attempt, no hand-over number', () => {
    expect(pushReceivedDeliverySchema.parse(delivery)).toEqual(delivery);
  });

  it('accepts a delivery handed already, with its last hand-over number', () => {
    const handed = { ...delivery, state: 'handed', attempts: 2, handOverNumber: 2 };

    expect(pushReceivedDeliverySchema.parse(handed)).toEqual(handed);
  });

  it.each([
    ['a pending delivery', { ...delivery, state: 'pending' }],
    ['an acknowledged delivery', { ...delivery, state: 'acknowledged' }],
    ['a hand-over number of 0', { ...delivery, state: 'handed', handOverNumber: 0 }],
    ['negative attempts', { ...delivery, attempts: -1 }],
  ])('rejects %s', (_label, candidate) => {
    expect(pushReceivedDeliverySchema.safeParse(candidate).success).toBe(false);
  });

  it('answers a push receive with no deliveries when the wait ended empty', () => {
    expect(pushReceiveOutputSchema.parse({ deliveries: [] })).toEqual({ deliveries: [] });
  });
});

describe('pushReceiveInputSchema', () => {
  it('takes no input, a max, and who wakes the ship', () => {
    expect(pushReceiveInputSchema.parse(undefined)).toBeUndefined();
    expect(pushReceiveInputSchema.parse({ max: 3, waker: 'gateway' })).toEqual({ max: 3, waker: 'gateway' });
  });

  it.each(['trierarch', 'pluginWatcher', 'personApp', 'gateway', 'adapter'])('takes %s as the waker', (waker) => {
    expect(pushReceiveInputSchema.parse({ waker })).toEqual({ waker });
  });

  it.each([['a waker it does not know', { waker: 'email' }], ['a max of 11', { max: 11 }]])('rejects %s', (_label, input) => {
    expect(pushReceiveInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('the channel of a hand-over (interop 5.1)', () => {
  const handed = (channel: unknown) => ({ deliveryId: newId('delivery'), handOverNumber: 1, channel });

  it.each(['tmux', 'watcher', 'tools/call', 'a2a-push', 'email', 'x'.repeat(32)])('takes %s', (channel) => {
    expect(handedInputSchema.parse(handed(channel)).channel).toBe(channel);
  });

  it.each([
    ['an empty one', ''],
    ['33 characters', 'x'.repeat(33)],
    ['capitals', 'Tmux'],
    ['a space', 'web push'],
  ])('rejects %s', (_label, channel) => {
    expect(handedInputSchema.safeParse(handed(channel)).success).toBe(false);
  });
});

describe('handedInputSchema', () => {
  it('takes the delivery and its hand-over number', () => {
    const input = { deliveryId: newId('delivery'), handOverNumber: 1 };

    expect(handedInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['a hand-over number of 0', 0],
    ['a fraction', 1.5],
    ['no hand-over number', undefined],
  ])('rejects %s', (_label, handOverNumber) => {
    expect(handedInputSchema.safeParse({ deliveryId: newId('delivery'), handOverNumber }).success).toBe(false);
  });

  it('rejects a message id for the delivery', () => {
    expect(handedInputSchema.safeParse({ deliveryId: newId('message'), handOverNumber: 1 }).success).toBe(false);
  });

  it('takes a hand-over once more, after the turn that took the confirmed message died', () => {
    const input = { deliveryId: newId('delivery'), handOverNumber: 2, isOnceMore: true };

    expect(handedInputSchema.parse(input)).toEqual(input);
  });

  it('rejects once more that is not a boolean', () => {
    expect(handedInputSchema.safeParse({ deliveryId: newId('delivery'), handOverNumber: 2, isOnceMore: 'yes' }).success).toBe(false);
  });
});

describe('handledInputSchema and notHandledInputSchema', () => {
  it.each([
    ['handled', handledInputSchema],
    ['notHandled', notHandledInputSchema],
  ])('%s takes the delivery', (_name, schema) => {
    const input = { deliveryId: newId('delivery') };

    expect(schema.parse(input)).toEqual(input);
  });

  it.each([
    ['handled', handledInputSchema],
    ['notHandled', notHandledInputSchema],
  ])('%s rejects a message id for the delivery', (_name, schema) => {
    expect(schema.safeParse({ deliveryId: newId('message') }).success).toBe(false);
  });

  it.each([
    ['handled', handledOutputSchema],
    ['notHandled', notHandledOutputSchema],
  ])('%s answers nothing: the OK is the answer', (_name, schema) => {
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ state: 'handled' }).success).toBe(false);
  });
});

describe('notHandledInputSchema: the reason the plugin gives (#847)', () => {
  const deliveryId = newId('delivery');

  it('takes the reason the crew judged it not handled for', () => {
    const input = { deliveryId, reason: 'the turn it was handed once more to died too' };

    expect(notHandledInputSchema.parse(input)).toEqual(input);
  });

  it('takes a reason of exactly the longest length, and refuses one character more', () => {
    expect(notHandledInputSchema.safeParse({ deliveryId, reason: 'x'.repeat(NOT_HANDLED_REASON_MAX_LENGTH) }).success).toBe(true);
    expect(notHandledInputSchema.safeParse({ deliveryId, reason: 'x'.repeat(NOT_HANDLED_REASON_MAX_LENGTH + 1) }).success).toBe(false);
  });

  it('refuses an empty reason', () => {
    expect(notHandledInputSchema.safeParse({ deliveryId, reason: '  ' }).success).toBe(false);
  });

  it('refuses a reason of more than one line', () => {
    expect(notHandledInputSchema.safeParse({ deliveryId, reason: 'died\nagain' }).success).toBe(false);
  });
});

describe('handedOutputSchema', () => {
  it.each(['handed', 'acknowledged', 'undeliverable'])('answers the state %s', (state) => {
    expect(handedOutputSchema.parse({ state })).toEqual({ state });
  });

  it('never answers received or pending', () => {
    expect(handedOutputSchema.safeParse({ state: 'received' }).success).toBe(false);
    expect(handedOutputSchema.safeParse({ state: 'pending' }).success).toBe(false);
  });
});
