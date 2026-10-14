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
    crewRequest: null,
    labels: [],
    harness: 'claude-code',
    model: { id: 'claude-opus-5-5', statedAt: AT },
    awaitingCrewSince: null,
    commissionedAt: AT,
    crewedSince: AT,
    retiredAt: null,
    inFlightDeliveries: 1,
    openDeliveries: 3,
  };

  it('accepts a ship with its commissioned date, when its crew came aboard and when it retired', () => {
    expect(shipDetailOutputSchema.parse(ship)).toEqual(ship);
  });

  it("accepts the crew's report with its details, their version and their size", () => {
    const reported = { ...ship, report: { state: 'working', note: null, reportedAt: AT, detailsVersion: 2, details: { running: 4 }, detailsBytes: 13 } };

    expect(shipDetailOutputSchema.parse(reported)).toEqual(reported);
  });

  it('accepts its crew request whole, settings included', () => {
    const requested = { ...ship, crewRequest: { settingsVersion: 1, requestedAt: AT, assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null, givenBack: [], settings: { harness: 'codex' } } };

    expect(shipDetailOutputSchema.parse(requested)).toEqual(requested);
  });

  it.each([
    ['a crew request without its settings', { ...ship, crewRequest: { settingsVersion: 1, requestedAt: AT, assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null } }],
    ['a report without its details', { ...ship, report: { state: 'working', note: null, reportedAt: AT, detailsVersion: 0, detailsBytes: null } }],
    ['a report without the size of its details', { ...ship, report: { state: 'working', note: null, reportedAt: AT, detailsVersion: 2, details: { running: 4 } } }],
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
    message: { id: newId('message'), sender: scout, recipient: { kind: 'ship', ship: planner }, contentType: 'text/plain', isPing: false, model: 'claude-opus-5-5' },
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

  it('accepts the content type of the message, and whether it is a ping', () => {
    const ping = { ...sent, message: { ...sent.message, contentType: 'application/vnd.aeolus.ping', isPing: true } };

    expect(shipTimelineOutputSchema.parse([ping])).toEqual([ping]);
  });

  it('rejects a message that does not tell whether it is a ping', () => {
    const message = { id: sent.message.id, sender: sent.message.sender, recipient: sent.message.recipient, contentType: sent.message.contentType, model: sent.message.model };

    expect(shipTimelineOutputSchema.safeParse([{ ...sent, message }]).success).toBe(false);
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
    delivery: { id: newId('delivery'), state: 'acknowledged', claimedBy: planner, isPulled: false },
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
  const trierarch = { id: newId('ship'), name: 'mac-mini' };
  const step = { location: null, harness: null, attempts: null, by: null, handOverNumber: null, isAgain: false, isOnceMore: false, overdue: null, leaseEnd: null };
  const message = {
    id: newId('message'),
    sender: scout,
    recipient: { kind: 'ship', ship: planner },
    inReplyTo: newId('message'),
    sentAt: AT,
    contentType: 'application/json',
    model: null,
    payload: '{"pr":48}',
    replies: [{ id: newId('message'), sender: planner, sentAt: AT }],
    delivery: {
      id: newId('delivery'),
      state: 'handed',
      attempts: 2,
      claimedBy: planner,
      way: {
        holder: { kind: 'agent' },
        since: AT,
        isPulled: false,
        overdue: { clock: 'notConfirmed', minutes: 10, toldAt: AT },
        lease: { by: { kind: 'trierarch', trierarch }, isEnded: false, turn: { turn: 'busy', at: AT } },
        crew: { status: 'running', attempt: 1, startedAt: AT },
      },
      history: [
        { ...step, seq: 6, type: 'DeliveryOverdue', occurredAt: AT, ship: planner, overdue: { clock: 'notConfirmed', minutes: 10 } },
        { ...step, seq: 5, type: 'DeliveryHanded', occurredAt: AT, ship: planner, location: { kind: 'DEVICE', description: null }, harness: 'claude-code', attempts: 2, by: { kind: 'trierarch', trierarch }, handOverNumber: 2 },
        { ...step, seq: 4, type: 'DeliveryReceived', occurredAt: AT, ship: planner, by: { kind: 'pluginWatcher' }, isAgain: true },
        { ...step, seq: 3, type: 'DeliveryReturned', occurredAt: AT, ship: planner, attempts: 1, leaseEnd: 'released' },
        { ...step, seq: 2, type: 'DeliveryHanded', occurredAt: AT, ship: planner, attempts: 1 },
        { ...step, seq: 1, type: 'MessageAccepted', occurredAt: AT, ship: null },
      ],
    },
  };

  it('accepts the envelope, the payload, its replies and the delivery with its way and its history, newest first', () => {
    expect(messageOutputSchema.parse(message)).toEqual(message);
  });

  it.each([
    ['the fleet', { kind: 'fleet' }],
    ['the trierarch on its computer', { kind: 'trierarch', trierarch }],
    ['the plugin watcher', { kind: 'pluginWatcher' }],
    ['nobody', null],
  ])('accepts a delivery held by %s', (_, holder) => {
    const way = { ...message.delivery.way, holder };

    expect(messageOutputSchema.safeParse({ ...message, delivery: { ...message.delivery, way } }).success).toBe(true);
  });

  it('accepts a delivery waiting for no lease, with no crew and not overdue', () => {
    const way = { ...message.delivery.way, holder: { kind: 'fleet' }, overdue: null, lease: null, crew: null };

    expect(messageOutputSchema.safeParse({ ...message, delivery: { ...message.delivery, way } }).success).toBe(true);
  });

  it.each(['DeliveryHandled', 'DeliveryNotHandled', 'DeliveryAbandoned', 'DeliveryDismissed'])('accepts %s in the history', (type) => {
    const history = [{ ...step, seq: 7, type, occurredAt: AT, ship: scout }];

    expect(messageOutputSchema.safeParse({ ...message, delivery: { ...message.delivery, history } }).success).toBe(true);
  });

  it('rejects a history entry of a type that is no delivery change', () => {
    const history = [{ ...message.delivery.history[1], type: 'ShipClaimed' }];

    expect(messageOutputSchema.safeParse({ ...message, delivery: { ...message.delivery, history } }).success).toBe(
      false,
    );
  });

  it('rejects a hand-over number below 1', () => {
    const history = [{ ...message.delivery.history[1], handOverNumber: 0 }];

    expect(messageOutputSchema.safeParse({ ...message, delivery: { ...message.delivery, history } }).success).toBe(
      false,
    );
  });

  it('rejects a holder of an unknown kind', () => {
    const way = { ...message.delivery.way, holder: { kind: 'session' } };

    expect(messageOutputSchema.safeParse({ ...message, delivery: { ...message.delivery, way } }).success).toBe(false);
  });
});
