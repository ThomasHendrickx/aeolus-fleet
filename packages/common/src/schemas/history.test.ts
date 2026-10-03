import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  messageInputSchema,
  messageOutputSchema,
  shipDetailOutputSchema,
  shipInputSchema,
  shipMessagesOutputSchema,
  shipTimelineOutputSchema,
} from './history.js';

const newId = createIdGenerator();
const scout = { id: newId('ship'), name: 'scout' };
const planner = { id: newId('ship'), name: 'planner' };
const AT = '2026-10-01T09:00:00.000Z';

describe('shipInputSchema', () => {
  it('takes a ship id', () => {
    const input = { shipId: scout.id };

    expect(shipInputSchema.parse(input)).toEqual(input);
  });

  it('refuses an id of another kind', () => {
    expect(shipInputSchema.safeParse({ shipId: newId('message') }).success).toBe(false);
  });
});

describe('shipDetailOutputSchema', () => {
  const ship = {
    id: scout.id,
    name: 'scout',
    type: 'reviewer',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: { issuedAt: AT, isClaimed: true },
    location: { kind: 'SERVER', description: null },
    lastSeenAt: AT,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null,
    harness: 'claude-code',
    model: { id: 'claude-opus-5-5', statedAt: AT },
    commissionedAt: AT,
    crewedSince: AT,
    retiredAt: null,
    inFlightDeliveries: 1,
    openDeliveries: 3,
  };

  it('accepts a ship with its commissioned date, when its crew came aboard and when it retired', () => {
    expect(shipDetailOutputSchema.parse(ship)).toEqual(ship);
  });

  it.each([
    ['a commissioned date that is not ISO 8601', { ...ship, commissionedAt: 'yesterday' }],
    ['a missing crewed since', { ...ship, crewedSince: undefined }],
    ['no count of deliveries in flight', { ...ship, inFlightDeliveries: undefined }],
    ['a negative count of open deliveries', { ...ship, openDeliveries: -1 }],
  ])('rejects %s', (_label, detail) => {
    expect(shipDetailOutputSchema.safeParse(detail).success).toBe(false);
  });
});

describe('shipTimelineOutputSchema', () => {
  const sent = {
    seq: 12,
    id: newId('event'),
    type: 'MessageAccepted',
    occurredAt: AT,
    actor: scout,
    ship: planner,
    message: { id: newId('message'), sender: scout, recipient: { kind: 'ship', ship: planner }, contentType: 'text/plain' },
    details: { selector: 'ship', recipientType: null },
  };

  it('accepts an event with who caused it, the ship and message it concerns, and its details', () => {
    expect(shipTimelineOutputSchema.parse([sent])).toEqual([sent]);
  });

  it('accepts a system event concerning no message, and a message to a type', () => {
    const system = { ...sent, type: 'FleetInitialised', actor: null, ship: null, message: null, details: {} };
    const toType = { ...sent, ship: null, message: { ...sent.message, recipient: { kind: 'type', type: 'reviewer' } } };

    expect(shipTimelineOutputSchema.parse([system, toType])).toEqual([system, toType]);
  });

  it('accepts the content type of the message, a ping told by it', () => {
    const ping = { ...sent, message: { ...sent.message, contentType: 'application/vnd.aeolus.ping' } };

    expect(shipTimelineOutputSchema.parse([ping])).toEqual([ping]);
  });

  it('rejects a message without its content type', () => {
    const message = { id: sent.message.id, sender: sent.message.sender, recipient: sent.message.recipient };

    expect(shipTimelineOutputSchema.safeParse([{ ...sent, message }]).success).toBe(false);
  });

  it.each([
    ['an unknown event type', { ...sent, type: 'ShipSank' }],
    ['a nested detail', { ...sent, details: { location: { kind: 'DEVICE' } } }],
  ])('rejects %s', (_label, entry) => {
    expect(shipTimelineOutputSchema.safeParse([entry]).success).toBe(false);
  });
});

describe('shipMessagesOutputSchema', () => {
  const message = {
    id: newId('message'),
    sender: scout,
    recipient: { kind: 'type', type: 'reviewer' },
    inReplyTo: null,
    sentAt: AT,
    contentType: 'text/plain',
    model: 'claude-opus-5-5',
    preview: 'Review PR 48',
    delivery: { id: newId('delivery'), state: 'acknowledged', claimedBy: planner },
  };

  it('accepts a message with its parties, its thread link, a preview and its delivery', () => {
    expect(shipMessagesOutputSchema.parse([message])).toEqual([message]);
  });

  it('rejects an unknown delivery state', () => {
    expect(
      shipMessagesOutputSchema.safeParse([{ ...message, delivery: { ...message.delivery, state: 'lost' } }]).success,
    ).toBe(false);
  });
});

describe('messageInputSchema', () => {
  it('takes a message id', () => {
    const input = { messageId: newId('message') };

    expect(messageInputSchema.parse(input)).toEqual(input);
  });
});

describe('messageOutputSchema', () => {
  const message = {
    id: newId('message'),
    sender: scout,
    recipient: { kind: 'ship', ship: planner },
    inReplyTo: newId('message'),
    sentAt: AT,
    contentType: 'application/json',
    model: null,
    payload: '{"pr":48}',
    delivery: {
      id: newId('delivery'),
      state: 'delivered',
      attempts: 2,
      claimedBy: planner,
      history: [
        { seq: 3, type: 'DeliveryClaimed', occurredAt: AT, ship: planner, location: { kind: 'DEVICE', description: null }, harness: 'claude-code', attempts: 2 },
        { seq: 2, type: 'DeliveryReturned', occurredAt: AT, ship: planner, location: null, harness: null, attempts: 1 },
        { seq: 1, type: 'MessageAccepted', occurredAt: AT, ship: null, location: null, harness: null, attempts: null },
      ],
    },
  };

  it('accepts the envelope, the payload and the delivery with its history, newest first', () => {
    expect(messageOutputSchema.parse(message)).toEqual(message);
  });

  it('accepts an abandoned delivery in the history', () => {
    const history = [{ seq: 4, type: 'DeliveryAbandoned', occurredAt: AT, ship: scout, location: null, harness: null, attempts: null }];

    expect(messageOutputSchema.safeParse({ ...message, delivery: { ...message.delivery, state: 'abandoned', history } }).success).toBe(
      true,
    );
  });

  it('accepts a dismissed delivery in the history', () => {
    const history = [{ seq: 6, type: 'DeliveryDismissed', occurredAt: AT, ship: null, location: null, harness: null, attempts: null }];

    expect(messageOutputSchema.safeParse({ ...message, delivery: { ...message.delivery, state: 'dismissed', history } }).success).toBe(
      true,
    );
  });

  it('rejects a history entry of a type that is no delivery change', () => {
    const history = [{ ...message.delivery.history[0], type: 'ShipClaimed' }];

    expect(messageOutputSchema.safeParse({ ...message, delivery: { ...message.delivery, history } }).success).toBe(
      false,
    );
  });
});
