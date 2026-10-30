import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  deliveryHistoryEntrySchema,
  messageInputSchema,
  messageDeliveriesInputSchema,
  messageDeliveriesOutputSchema,
  messageOutputSchema,
  shipDetailOutputSchema,
  shipOutputSchema,
  shipInputSchema,
  shipMessagesInputSchema,
  shipMessagesOutputSchema,
  shipTimelineInputSchema,
  shipTimelineOutputSchema,
} from './history.js';

const newId = createIdGenerator();
const scout = { id: newId('ship'), name: 'scout' };
const planner = { id: newId('ship'), name: 'planner' };
const AT = '2026-10-01T09:00:00.000Z';

describe('shipTimelineInputSchema', () => {
  it('takes a ship id, and the cursor and size of a page of its events', () => {
    const input = { shipId: scout.id, cursor: newId('event'), limit: 50 };

    expect(shipTimelineInputSchema.parse(input)).toEqual(input);
  });

  it('refuses a cursor that names no event', () => {
    expect(shipTimelineInputSchema.safeParse({ shipId: scout.id, cursor: newId('message') }).success).toBe(false);
  });
});

describe('shipMessagesInputSchema', () => {
  it('takes a ship id, and the cursor and size of a page of its messages', () => {
    const input = { shipId: scout.id, cursor: newId('message'), limit: 20 };

    expect(shipMessagesInputSchema.parse(input)).toEqual(input);
  });

  it('refuses a cursor that names no message', () => {
    expect(shipMessagesInputSchema.safeParse({ shipId: scout.id, cursor: newId('event') }).success).toBe(false);
  });
});

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
    ownerShipId: null,
    inFlightDeliveries: 1,
    openDeliveries: 3,
    owner: { id: newId('ship'), name: 'argo' },
    commissionedByShipId: newId('ship'),
    statement: null,
  };

  it('accepts a ship with its commissioned date, when its crew came aboard and when it retired', () => {
    expect(shipDetailOutputSchema.parse(ship)).toEqual(ship);
  });

  it("accepts the crew's report with its details, their version and their size", () => {
    const reported = { ...ship, report: { state: 'working', note: null, reportedAt: AT, detailsVersion: 2, details: { running: 4 }, detailsBytes: 13 } };

    expect(shipDetailOutputSchema.parse(reported)).toEqual(reported);
  });

  it("accepts its crew's statement, or its commission note (decision 0047)", () => {
    const stated = { ...ship, statement: { by: 'crew', version: 1, summary: 'Reviews pull requests.', capabilities: [{ name: 'review_pr' }] } };
    const noted = { ...ship, statement: { by: 'commission', note: 'Keeps the release keys' } };

    expect([shipDetailOutputSchema.parse(stated), shipDetailOutputSchema.parse(noted)]).toEqual([stated, noted]);
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
    ['a missing owner', { ...ship, owner: undefined }],
    ['a missing statement', { ...ship, statement: undefined }],
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
    signedInAccountId: null,
    ship: planner,
    message: { id: newId('message'), sender: scout, recipient: { kind: 'ship', ship: planner }, contentType: 'text/plain', isPing: false, model: 'claude-opus-5-5' },
    details: { selector: 'ship', recipientType: null },
  };

  /** A last page of the timeline holding the entries. */
  const timelinePage = (...entries: unknown[]) => ({ items: entries, nextCursor: null });

  it('accepts a page with the cursor of its last event, to read the next page from', () => {
    expect(shipTimelineOutputSchema.parse({ items: [sent], nextCursor: sent.id })).toEqual({ items: [sent], nextCursor: sent.id });
  });

  it('accepts an event with who caused it, the ship and message it concerns, and its details', () => {
    expect(shipTimelineOutputSchema.parse(timelinePage(sent))).toEqual(timelinePage(sent));
  });

  it('accepts the account signed in to the console as argo when argo caused it, by its id only (decision 0054)', () => {
    const signedIn = { ...sent, signedInAccountId: 'acc-01mathilde' };

    expect(shipTimelineOutputSchema.parse(timelinePage(signedIn))).toEqual(timelinePage(signedIn));
  });

  it('accepts a system event concerning no message, and a message to a type', () => {
    const system = { ...sent, type: 'FleetInitialised', actor: null, ship: null, message: null, details: {} };
    const toType = { ...sent, ship: null, message: { ...sent.message, recipient: { kind: 'type', type: 'reviewer' } } };

    expect(shipTimelineOutputSchema.parse(timelinePage(system, toType))).toEqual(timelinePage(system, toType));
  });

  it('accepts the content type of the message, and whether it is a ping', () => {
    const ping = { ...sent, message: { ...sent.message, contentType: 'application/vnd.aeolus.ping', isPing: true } };

    expect(shipTimelineOutputSchema.parse(timelinePage(ping))).toEqual(timelinePage(ping));
  });

  it('rejects a message that does not tell whether it is a ping', () => {
    const message = { id: sent.message.id, sender: sent.message.sender, recipient: sent.message.recipient, contentType: sent.message.contentType, model: sent.message.model };

    expect(shipTimelineOutputSchema.safeParse(timelinePage({ ...sent, message })).success).toBe(false);
  });

  it('rejects a message without its content type', () => {
    const message = { id: sent.message.id, sender: sent.message.sender, recipient: sent.message.recipient };

    expect(shipTimelineOutputSchema.safeParse(timelinePage({ ...sent, message })).success).toBe(false);
  });

  it.each([
    ['an unknown event type', { ...sent, type: 'ShipSank' }],
    ['a nested detail', { ...sent, details: { location: { kind: 'DEVICE' } } }],
    ['no signed-in account', { ...sent, signedInAccountId: undefined }],
  ])('rejects %s', (_label, entry) => {
    expect(shipTimelineOutputSchema.safeParse(timelinePage(entry)).success).toBe(false);
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
    isPayloadUnreadable: false,
    isPayloadSealed: false,
    delivery: { id: newId('delivery'), state: 'acknowledged', claimedBy: planner, isPulled: false },
  };

  it('accepts a page of messages with their parties, thread link, preview and delivery, and the cursor of its last', () => {
    const page = { items: [message], nextCursor: message.id };

    expect(shipMessagesOutputSchema.parse(page)).toEqual(page);
  });

  it('rejects an unknown delivery state', () => {
    expect(
      shipMessagesOutputSchema.safeParse({ items: [{ ...message, delivery: { ...message.delivery, state: 'lost' } }], nextCursor: null }).success,
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
  const step = { location: null, harness: null, attempts: null, by: null, handOverNumber: null, channel: null, isAgain: false, isOnceMore: false, overdue: null, leaseEnd: null };
  const message = {
    id: newId('message'),
    sender: scout,
    recipient: { kind: 'ship', ship: planner },
    inReplyTo: newId('message'),
    sentAt: AT,
    contentType: 'application/json',
    model: null,
    payload: '{"pr":48}',
    isPayloadUnreadable: false,
    isPayloadSealed: false,
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
    deliveryCount: 1,
  };

  it('accepts the envelope, the payload, its replies and the delivery with its way and its history, newest first', () => {
    expect(messageOutputSchema.parse(message)).toEqual(message);
  });

  it('refuses a delivery count below zero', () => {
    expect(messageOutputSchema.safeParse({ ...message, deliveryCount: -1 }).success).toBe(false);
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

describe('who wakes a lease and the channel a hand-over went through (interop 5.1)', () => {
  const step = { location: null, harness: null, attempts: 1, by: { kind: 'gateway' }, handOverNumber: 1, channel: 'tools/call', isAgain: false, isOnceMore: false, overdue: null, leaseEnd: null };
  const handed = { ...step, seq: 2, type: 'DeliveryHanded', occurredAt: AT, ship: planner };

  it.each(['gateway', 'personApp', 'adapter'])('takes the %s as the computer side of a step', (kind) => {
    const entry = { ...handed, by: { kind } };

    expect(deliveryHistoryEntrySchema.parse(entry)).toEqual(entry);
  });

  it('takes the channel a hand-over went through', () => {
    expect(deliveryHistoryEntrySchema.parse(handed).channel).toBe('tools/call');
  });
});

describe('shipOutputSchema', () => {
  it('accepts a ship outside read reach by its name, type and status only (decision 0034)', () => {
    const outside = { id: createIdGenerator()('ship'), name: 'vault', type: 'keeper', status: 'retired', isInReadReach: false };

    expect(shipOutputSchema.parse(outside)).toEqual(outside);
  });
});

describe('messageDeliveriesOutputSchema', () => {
  it('accepts a page of the deliveries of a send to a label, a ship each, and a type delivery no ship claimed yet, with the next cursor (decision 0065)', () => {
    const deliveries = [
      { id: newId('delivery'), ship: planner, state: 'acknowledged', since: AT },
      { id: newId('delivery'), ship: null, state: 'pending', since: AT },
    ];
    const page = { items: deliveries, nextCursor: deliveries[1]?.id };

    expect(messageDeliveriesOutputSchema.parse(page)).toEqual(page);
  });
});

describe('messageDeliveriesInputSchema', () => {
  it('takes the message, and the cursor and size of a page of its deliveries', () => {
    const input = { messageId: newId('message'), cursor: newId('delivery'), limit: 20 };

    expect(messageDeliveriesInputSchema.parse(input)).toEqual(input);
  });
});
